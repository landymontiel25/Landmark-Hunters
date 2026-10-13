// An in-memory stand-in for the firebase-admin Firestore API, for endpoint
// tests (not a route: api/loadRoutes.test.js only imports api/*.js). Covers
// what the tip, follow and nightly code uses: doc get/set/update/delete,
// where/limit queries, collection groups, batches and transactions, and the
// FieldValue sentinels from fakeFieldValue below.
//
//   const db = fakeDb();           db.docs is { 'tips/a_b': {...} }
//   vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue, FieldPath: fakeFieldPath }));

export const fakeFieldValue = {
  serverTimestamp: () => ({ __op: 'ts' }),
  increment: (n) => ({ __op: 'inc', n }),
  arrayUnion: (...v) => ({ __op: 'union', v }),
  arrayRemove: (...v) => ({ __op: 'remove', v }),
  delete: () => ({ __op: 'delete' }),
};
export const fakeFieldPath = { documentId: () => '__id__' };

export const FAKE_NOW_TS = { __ts: true, toMillis: () => fakeNow() };
let nowFn = () => Date.now();
export const fakeNow = () => nowFn();
export const setFakeNow = (fn) => {
  nowFn = fn;
};

const isOp = (v) => v && typeof v === 'object' && typeof v.__op === 'string';

function applyValue(prev, v) {
  if (!isOp(v)) return v;
  switch (v.__op) {
    case 'ts':
      return { toMillis: () => fakeNow(), _ts: fakeNow() };
    case 'inc':
      return (typeof prev === 'number' ? prev : 0) + v.n;
    case 'union':
      return [...(Array.isArray(prev) ? prev : []), ...v.v.filter((x) => !(prev || []).includes(x))];
    case 'remove':
      return (Array.isArray(prev) ? prev : []).filter((x) => !v.v.includes(x));
    default:
      return prev;
  }
}

function setPath(obj, dotted, v) {
  const parts = dotted.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    o[parts[i]] = o[parts[i]] && typeof o[parts[i]] === 'object' ? { ...o[parts[i]] } : {};
    o = o[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (isOp(v) && v.__op === 'delete') delete o[last];
  else o[last] = applyValue(o[last], v);
}

function merge(prev, data, { dotted = false } = {}) {
  const out = JSON.parse(JSON.stringify(prev || {}, (k, v) => v));
  // Keep functions (toMillis) from earlier server timestamps.
  for (const [k, v] of Object.entries(prev || {})) if (v && typeof v === 'object' && typeof v.toMillis === 'function') out[k] = v;
  for (const [k, v] of Object.entries(data)) {
    if (dotted && k.includes('.')) setPath(out, k, v);
    else if (isOp(v) && v.__op === 'delete') delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && !isOp(v) && typeof v.toMillis !== 'function' && !dotted) {
      out[k] = merge(out[k], v);
    } else out[k] = applyValue(out[k], v);
  }
  return out;
}

function resolve(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (isOp(v)) {
      if (v.__op !== 'delete') out[k] = applyValue(undefined, v);
    } else if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.toMillis !== 'function') out[k] = resolve(v);
    else out[k] = v;
  }
  return out;
}

const getField = (data, path) => (path === '__id__' ? undefined : path.split('.').reduce((o, p) => (o == null ? undefined : o[p]), data));

function matches(data, id, [field, op, value]) {
  const v = field === '__id__' ? id : getField(data, field);
  const num = (x) => (x && typeof x.toMillis === 'function' ? x.toMillis() : x);
  switch (op) {
    case '==':
      return num(v) === num(value);
    case '!=':
      return num(v) !== num(value);
    case '>':
      return num(v) > num(value);
    case '>=':
      return num(v) >= num(value);
    case '<':
      return num(v) < num(value);
    case '<=':
      return num(v) <= num(value);
    case 'in':
      return value.includes(v);
    case 'array-contains':
      return Array.isArray(v) && v.includes(value);
    default:
      throw new Error(`fakeDb: op ${op}`);
  }
}

export function fakeDb(initial = {}) {
  const docs = { ...initial };
  const writes = [];
  const snap = (path) => {
    const id = path.split('/').pop();
    const data = docs[path];
    return { id, exists: data !== undefined, ref: ref(path), data: () => (data === undefined ? undefined : data) };
  };
  function ref(path) {
    return {
      id: path.split('/').pop(),
      path,
      parent: { parent: path.split('/').length > 2 ? ref(path.split('/').slice(0, -2).join('/')) : null },
      get: async () => snap(path),
      set: async (data, opts) => setDoc(path, data, opts),
      update: async (data) => updateDoc(path, data),
      delete: async () => {
        writes.push(['delete', path]);
        delete docs[path];
      },
      collection: (n) => collection(`${path}/${n}`),
    };
  }
  function setDoc(path, data, opts = {}) {
    writes.push(['set', path, data]);
    docs[path] = opts.merge ? merge(docs[path], data) : resolve(data);
  }
  function updateDoc(path, data) {
    if (docs[path] === undefined) throw Object.assign(new Error(`No document to update: ${path}`), { code: 5 });
    writes.push(['update', path, data]);
    docs[path] = merge(docs[path], data, { dotted: true });
  }
  function query(prefix, filters = [], lim = null, group = false, order = null) {
    const q = {
      where: (f, op, v) => query(prefix, [...filters, [typeof f === 'string' ? f : '__id__', op, v]], lim, group, order),
      limit: (n) => query(prefix, filters, n, group, order),
      orderBy: (f, dir = 'asc') => query(prefix, filters, lim, group, [typeof f === 'string' ? f : '__id__', dir]),
      startAfter: () => q,
      get: async () => {
        let paths = Object.keys(docs).filter((p) => {
          const parts = p.split('/');
          if (group) return parts.length >= 2 && parts[parts.length - 2] === prefix;
          return p.startsWith(`${prefix}/`) && parts.length === prefix.split('/').length + 1;
        });
        paths = paths.filter((p) => filters.every((f) => matches(docs[p], p.split('/').pop(), f)));
        if (order) {
          const [f, dir] = order;
          const val = (p) => {
            const v = f === '__id__' ? p : getField(docs[p], f);
            return v && typeof v.toMillis === 'function' ? v.toMillis() : v;
          };
          paths.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
        }
        if (lim != null) paths = paths.slice(0, lim);
        const list = paths.map(snap);
        return { docs: list, size: list.length, empty: list.length === 0, forEach: (fn) => list.forEach(fn) };
      },
    };
    return q;
  }
  function collection(name) {
    return { ...query(name), doc: (id) => ref(`${name}/${id}`), add: async (data) => {
      const id = `auto${Object.keys(docs).length}_${Math.random().toString(36).slice(2, 8)}`;
      setDoc(`${name}/${id}`, data);
      return ref(`${name}/${id}`);
    } };
  }
  function batch() {
    const ops = [];
    return {
      set: (r, d, o) => ops.push(() => setDoc(r.path, d, o)),
      update: (r, d) => ops.push(() => updateDoc(r.path, d)),
      delete: (r) => ops.push(() => r.delete()),
      commit: async () => {
        for (const f of ops) await f();
      },
    };
  }
  return {
    docs,
    writes,
    collection,
    collectionGroup: (name) => query(name, [], null, true),
    doc: (path) => ref(path),
    batch,
    runTransaction: async (fn) => {
      const b = batch();
      const tx = {
        get: async (x) => (typeof x.where === 'function' && !x.path ? x.get() : x.get()),
        getAll: async (...refs) => Promise.all(refs.map((r) => r.get())),
        set: (r, d, o) => {
          b.set(r, d, o);
          return tx;
        },
        update: (r, d) => {
          b.update(r, d);
          return tx;
        },
        delete: (r) => {
          b.delete(r);
          return tx;
        },
      };
      const out = await fn(tx);
      await b.commit();
      return out;
    },
  };
}
