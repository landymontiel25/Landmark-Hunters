import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';
import { putJob, listJobs, registerOutboxHandler, updateJob } from './outbox';
import { uploadCheckinPhotoFile, addCheckinPhotoURL } from './leaderboard';
import { OFFLINE_FREE_PER_DAY, presenceLabel, offlineCheckinDecision } from './presence';

// Check-ins made with no internet (owner, 2026-11-24). GPS works offline, so
// the phone keeps the fix, the moment, the photo and the rating in its
// outbox (outbox.js) and syncs them when it's back online: the server
// (api/offline-checkin.js) creates the check-in, checks the fix (and the
// photo when the fix was close but not inside the radius) and pays only
// then. Free accounts: OFFLINE_FREE_PER_DAY a day; Pro: no limit.

// What counts is where they were when they checked in, never where they are
// when the phone gets signal back (owner, 2026-11-24). The phone knows the
// fix it just saved, so the message says how this one will go.
export const OFFLINE_HINT =
  "You're offline. Check in anyway: it counts from where you are right now, so if you're within 30 meters of the place you'll get the points once you're back online, wherever you are then.";
export const OFFLINE_SAVED_MESSAGE =
  "You're offline, so this check-in is saved on your phone. It counts from where you were when you checked in, so you'll get the points once you're back online, wherever you are then.";

// The "Saved on your phone" line for the fix this check-in was saved with.
export function offlineSavedMessage(landmark, fix, nowMs = Date.now()) {
  const d = offlineCheckinDecision({ place: landmark, fix, capturedAtMs: nowMs, nowMs });
  const lead = "You're offline, so this check-in is saved on your phone.";
  const anywhere = "no matter where you are then";
  if (d.tier === 'gps') return `${lead} You were within ${d.radiusMeters} meters when you checked in, so you'll get the points when you're back online, ${anywhere}.`;
  if (d.tier === 'photo') {
    return `${lead} You were about ${Math.round(d.distanceMeters)} meters away when you checked in, outside its ${d.radiusMeters}-meter check-in area, so it earns points when you're back online only if your photo shows the place, ${anywhere}.`;
  }
  if (d.reason === 'too-far') return `${lead} You were too far from the place when you checked in, so it'll be saved but won't earn points.`;
  return OFFLINE_SAVED_MESSAGE;
}
export const OFFLINE_LIMIT_MESSAGE = `You've used today's ${OFFLINE_FREE_PER_DAY} offline check-ins. Pro has no limit. Check in here again when you're back online.`;
export const OFFLINE_CHECKIN_SYNCED_EVENT = 'lh:offline-checkin-synced';
export const OFFLINE_NEEDS_GPS_MESSAGE = "I couldn't get your GPS position, so this check-in can't be saved offline. Try again in the open.";

const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const COUNT_KEY = (uid) => `lh.offlineCheckins.${uid}`;
const PRO_KEY = (uid) => `lh.pro.${uid}`;
const readJson = (k, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or blocked: the server still enforces the limit */
  }
};

// Pro, as last seen online (entitlements/{uid}, server-written). Offline the
// phone goes by that; the server decides for real on sync.
export async function refreshPro(uid) {
  if (!db || !uid) return false;
  try {
    const snap = await getDoc(doc(db, 'entitlements', uid));
    const pro = snap.exists() && snap.data()?.pro === true;
    writeJson(PRO_KEY(uid), pro);
    return pro;
  } catch {
    return readJson(PRO_KEY(uid), false);
  }
}
export const isProCached = (uid) => readJson(PRO_KEY(uid), false) === true;

// Offline check-ins made today on this phone, waiting or already synced.
export function offlineCheckinsToday(uid, nowMs = Date.now()) {
  const c = readJson(COUNT_KEY(uid), {});
  return c.day === dayOf(nowMs) ? c.count || 0 : 0;
}
function countOne(uid, nowMs) {
  writeJson(COUNT_KEY(uid), { day: dayOf(nowMs), count: offlineCheckinsToday(uid, nowMs) + 1 });
}
export const canCheckInOffline = (uid, nowMs = Date.now()) => isProCached(uid) || offlineCheckinsToday(uid, nowMs) < OFFLINE_FREE_PER_DAY;

/**
 * Saves a check-in on the phone. fix: { lat, lng, accuracy, timestamp }.
 * review: the rating to save once it syncs (submitReview args, no photos),
 * photos: the picked photo Files. Returns the job.
 */
export async function queueOfflineCheckin({ uid, landmark, fix, review = null, photos = [], nowMs = Date.now() }) {
  const job = await putJob({
    uid,
    kind: 'checkin',
    payload: {
      region: landmark.regionId ?? landmark.region,
      landmarkId: landmark.id,
      landmarkName: landmark.name,
      fix: { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, timestamp: fix.timestamp, ...(typeof fix.mocked === 'boolean' ? { mocked: fix.mocked } : {}) },
      capturedAtMs: nowMs,
      review,
    },
    files: photos.slice(0, 3),
    giveUpNotice: `Your offline check-in at ${landmark.name} couldn't be sent.`,
  });
  countOne(uid, nowMs);
  return job;
}

export const pendingOfflineCheckins = (uid) => listJobs(uid, 'checkin');

// What the traveler hears once it synced.
export function syncedNotice(name, out) {
  if (out.reason === 'offline-limit') return `Your offline check-in at ${name} was over today's ${out.limit || OFFLINE_FREE_PER_DAY} offline check-ins, so it wasn't saved.`;
  if (!out.saved) return `Your offline check-in at ${name} couldn't be saved.`;
  if (out.sameDay) return `Your offline check-in at ${name} synced. You'd already checked in there that day.`;
  if (out.verified) return out.awarded > 0 ? `Your offline check-in at ${name} synced and it's verified. +${out.awarded} points.` : `Your offline check-in at ${name} synced and it's verified.`;
  const why = presenceLabel({ verified: false, reason: out.reason }) || 'Not verified';
  const extra = out.reason === 'photo-not-of-place' ? 'the photo doesn\'t show the place' : out.reason === 'needs-photo' ? 'you weren\'t close enough and there was no photo' : why.replace(/^Not verified: /, '').toLowerCase();
  return `Your offline check-in at ${name} synced, but it couldn't be verified (${extra}), so it didn't earn points.`;
}

// Sends one waiting check-in. Hooks are passed in so this file needs no
// rating code (CheckInContext wires saveReview).
export function makeCheckinHandler({ fetchImpl = (...a) => fetch(...a), upload = uploadCheckinPhotoFile, addPhoto = addCheckinPhotoURL, saveReview = null, onSynced = null } = {}) {
  return async (job) => {
    const p = job.payload;
    // The first photo goes up first: the server may need it to verify.
    let photoURLs = p.photoURLs || [];
    if (job.files?.length && photoURLs.length < job.files.length) {
      try {
        for (const f of job.files.slice(photoURLs.length)) {
          photoURLs = [...photoURLs, await upload(job.uid, p.landmarkId, f)];
          // Kept on the job, so a retry never uploads it twice.
          await updateJob(job.id, { payload: { ...p, photoURLs } });
        }
      } catch {
        return { retry: true, error: 'photo upload' };
      }
    }
    let r;
    try {
      r = await fetchImpl(`${API_BASE}/api/offline-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ clientId: job.id, region: p.region, landmarkId: p.landmarkId, fix: p.fix, capturedAtMs: p.capturedAtMs, photoURL: photoURLs[0] || null }),
      });
    } catch {
      return { retry: true, error: 'network' };
    }
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      // A request the server will never take (400, 403): tell them and stop.
      if (r.status === 400 || r.status === 403) return { drop: true, notice: `Your offline check-in at ${p.landmarkName} couldn't be sent.` };
      return { retry: true, error: out.error || `HTTP ${r.status}` };
    }
    // Saved: the photos go on the check-in's gallery, then the rating.
    if (out.saved) {
      for (const url of photoURLs) await addPhoto(job.uid, p.landmarkId, url).catch(() => {});
      if (p.review && saveReview) await saveReview(p.review).catch(() => {});
    }
    onSynced?.(job, out);
    return { done: true, notice: syncedNotice(p.landmarkName, out), tone: out.verified ? 'success' : 'info' };
  };
}

export function registerOfflineCheckins(hooks) {
  registerOutboxHandler('checkin', makeCheckinHandler(hooks));
}
