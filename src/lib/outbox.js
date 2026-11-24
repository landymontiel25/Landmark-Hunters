// The phone's outbox (owner, 2026-11-24: anything done offline is saved on
// the phone and syncs on its own when the connection is back, no retry
// button). A job is { id, uid, kind, payload, files, createdAt, tries }:
// `files` are the photos themselves (Blobs), kept in IndexedDB so they
// survive the app being closed. Each kind has a handler (registerOutboxHandler)
// that does the work once online and answers:
//   { done: true, notice? }   finished: the job goes
//   { retry: true }           not yet (offline, server busy): kept, tried again
//   { drop: true, notice? }   can't ever work (refused): the job goes, with a word why
// flushOutbox runs every job in order; startOutboxSync runs it on launch,
// when the phone comes back online, when the app comes back to the front, and
// every minute while there's anything waiting.

const DB_NAME = 'lh-outbox';
const STORE = 'jobs';
export const OUTBOX_CHANGED_EVENT = 'lh:outbox-changed';
export const OUTBOX_NOTICE_EVENT = 'lh:outbox-notice';
const MAX_TRIES = 200;

// IndexedDB, or a Map when it isn't there (tests, a blocked private window).
let memory = null;
let dbPromise = null;
function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}
const mem = () => (memory ||= new Map());

async function tx(mode, fn) {
  const db = await openDb();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    Promise.resolve(fn(store)).then((v) => (out = v), reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  });
}
const req = (r) => new Promise((resolve, reject) => ((r.onsuccess = () => resolve(r.result)), (r.onerror = () => reject(r.error))));

function changed() {
  try {
    window.dispatchEvent(new CustomEvent(OUTBOX_CHANGED_EVENT));
  } catch {
    /* no window */
  }
}
export function outboxNotice(message, tone = 'info') {
  try {
    window.dispatchEvent(new CustomEvent(OUTBOX_NOTICE_EVENT, { detail: { message, tone } }));
  } catch {
    /* no window */
  }
}

export const newJobId = () => {
  const a = new Uint32Array(3);
  (globalThis.crypto?.getRandomValues?.(a) ?? a.forEach((_, i) => (a[i] = Math.floor(Math.random() * 2 ** 32))));
  return `${Date.now().toString(36)}${[...a].map((n) => n.toString(36)).join('')}`.slice(0, 40);
};

export async function putJob(job) {
  const full = { tries: 0, createdAt: Date.now(), files: [], ...job, id: job.id || newJobId() };
  await tx('readwrite', (s) => (s ? req(s.put(full)) : mem().set(full.id, full)));
  changed();
  return full;
}

export async function updateJob(id, patch) {
  await tx('readwrite', async (s) => {
    const cur = s ? await req(s.get(id)) : mem().get(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    if (s) await req(s.put(next));
    else mem().set(id, next);
  });
}

export async function deleteJob(id) {
  await tx('readwrite', (s) => (s ? req(s.delete(id)) : mem().delete(id)));
  changed();
}

export async function listJobs(uid, kind = null) {
  const all = await tx('readonly', (s) => (s ? req(s.getAll()) : [...mem().values()]));
  return (all || []).filter((j) => j.uid === uid && (!kind || j.kind === kind)).sort((a, b) => a.createdAt - b.createdAt);
}

const handlers = new Map();
export function registerOutboxHandler(kind, fn) {
  handlers.set(kind, fn);
}

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
let flushing = null;
// Runs every waiting job for this account, oldest first. One flush at a time.
export function flushOutbox(uid) {
  if (!uid || !online()) return Promise.resolve({ done: 0, waiting: null });
  if (flushing) return flushing;
  flushing = (async () => {
    let done = 0;
    for (const job of await listJobs(uid)) {
      const run = handlers.get(job.kind);
      if (!run) continue;
      let out;
      try {
        out = await run(job);
      } catch (e) {
        out = { retry: true, error: String(e?.message || e) };
      }
      if (out?.done || out?.drop) {
        await deleteJob(job.id);
        if (out.notice) outboxNotice(out.notice, out.tone || (out.drop ? 'error' : 'success'));
        done++;
      } else {
        const tries = (job.tries || 0) + 1;
        // Something that fails this many times isn't going to work: say so
        // rather than trying forever.
        if (tries >= MAX_TRIES) {
          await deleteJob(job.id);
          outboxNotice(job.giveUpNotice || "Something you saved offline couldn't be sent.", 'error');
        } else await updateJob(job.id, { tries, lastError: out?.error || null });
      }
      if (!online()) break;
    }
    return { done, waiting: (await listJobs(uid)).length };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

// Keeps the outbox moving for the signed-in account. Returns a stop function.
export function startOutboxSync(getUid, { intervalMs = 60000 } = {}) {
  if (typeof window === 'undefined') return () => {};
  const kick = () => {
    const uid = getUid();
    if (uid) flushOutbox(uid).catch(() => {});
  };
  const onVisible = () => document.visibilityState === 'visible' && kick();
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(kick, intervalMs);
  kick();
  return () => {
    window.removeEventListener('online', kick);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}

// Tests only.
export function _resetOutboxForTests() {
  memory = null;
  handlers.clear();
  flushing = null;
}
