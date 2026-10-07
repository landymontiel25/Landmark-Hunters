import { FieldValue } from 'firebase-admin/firestore';
import { isTimeoutError } from './upstream.js';
import { PLACE_ID_NO_MATCH_RETRY_MS } from './placeIdConstants.js';
import { isFresh, logFailure, placeIdKey, readPlaceId, textSearchMatch, writePlaceId } from './placeLookup.js';
import {
  PHOTO_BACKFILL_BATCH,
  PHOTO_BACKFILL_BUDGET_MS,
  PHOTO_BACKFILL_DAILY_SEARCHES,
  PHOTO_BACKFILL_FAIL_STREAK,
  PHOTO_BACKFILL_USAGE_COLLECTION,
} from '../../src/lib/statsConstants.js';

// One-time admin job: for every landmark with no stored photo, find its Google
// place ID (the same strict Text Search match api/place-photo.js uses) and save
// it to place_ids, so later views skip the search. It saves place IDs only: no
// photo, photo name or photo link is fetched or stored (Google's terms).
//
// Each call does one batch and is safe to repeat: landmarks that already have a
// saved result (a place ID, or a "no match" under 30 days old) are skipped, and a
// failed search is not saved, so it is retried on the next call.
//
// Limits: PHOTO_BACKFILL_DAILY_SEARCHES text searches per Pacific-time day (a
// counter in place_backfill_usage/{date}, server-only), PHOTO_BACKFILL_BATCH
// per call. The page spaces calls out to stay under the per-account rate limit.

// Google resets its daily quotas at midnight Pacific time.
export function quotaDay(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(now));
}

const hasCoords = (l) => Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng));
const regionOf = (l) => l.regionId || l.region;

function savedState(doc) {
  if (doc?.status === 'ok' && doc.placeId) return 'ok';
  if (doc?.status === 'no-match' && isFresh(doc, PLACE_ID_NO_MATCH_RETRY_MS)) return 'noMatch';
  return 'todo';
}

export async function runPhotoBackfill(
  db,
  landmarks,
  { apiKey, now = Date.now(), batchSize = PHOTO_BACKFILL_BATCH, dailyLimit = PHOTO_BACKFILL_DAILY_SEARCHES, search = textSearchMatch } = {},
) {
  const candidates = landmarks.filter((l) => !(l.images && l.images.length) && l.name);
  const searchable = candidates.filter(hasCoords);

  const saved = { ok: 0, noMatch: 0 };
  const todo = [];
  for (let i = 0; i < searchable.length; i += 25) {
    const chunk = searchable.slice(i, i + 25);
    const docs = await Promise.all(chunk.map((l) => { const k = placeIdKey(regionOf(l), l.id); return k ? readPlaceId(k) : Promise.resolve(null); }));
    chunk.forEach((l, j) => {
      const state = savedState(docs[j]);
      if (state === 'ok') saved.ok += 1;
      else if (state === 'noMatch') saved.noMatch += 1;
      else todo.push(l);
    });
  }

  const usageRef = db.collection(PHOTO_BACKFILL_USAGE_COLLECTION).doc(quotaDay(now));
  const usageSnap = await usageRef.get();
  const usedBefore = usageSnap.exists ? Number(usageSnap.data()?.searches) || 0 : 0;
  const room = Math.max(0, dailyLimit - usedBefore);

  const out = { matched: 0, noMatch: 0, failed: 0, searched: 0 };
  let stopped = null;
  let streak = 0;
  const batch = todo.slice(0, Math.min(batchSize, room));
  const startedAt = Date.now();
  for (const l of batch) {
    if (Date.now() - startedAt > PHOTO_BACKFILL_BUDGET_MS) break; // leave the rest for the next call; the function has a 60 s limit
    const key = placeIdKey(regionOf(l), l.id);
    if (!key) continue;
    out.searched += 1;
    let found;
    try {
      found = await search(l.name, Number(l.lat), Number(l.lng), apiKey);
    } catch (e) {
      logFailure(isTimeoutError(e) ? 'timeout' : 'search', `backfill: ${e?.name || 'Error'}`, key);
      out.failed += 1;
      streak += 1;
      if (streak >= PHOTO_BACKFILL_FAIL_STREAK) { stopped = 'failing'; break; }
      continue;
    }
    if (found.error) {
      logFailure('search', `backfill: Google status ${found.status}`, key);
      out.failed += 1;
      streak += 1;
      if (found.status === 429) { stopped = 'google-quota'; break; }
      if (found.status === 403) { stopped = 'google-denied'; break; }
      if (streak >= PHOTO_BACKFILL_FAIL_STREAK) { stopped = 'failing'; break; }
      continue;
    }
    streak = 0;
    if (!found.match) {
      await writePlaceId(key, { status: 'no-match', placeId: null, matchedName: String(l.name || '').slice(0, 200), lat: Number(l.lat), lng: Number(l.lng) });
      out.noMatch += 1;
    } else {
      await writePlaceId(key, {
        status: 'ok',
        placeId: found.match.id || null,
        matchedName: String(found.match.displayName?.text || '').slice(0, 200),
        lat: Number(l.lat),
        lng: Number(l.lng),
      });
      out.matched += 1;
    }
  }

  if (out.searched > 0) await usageRef.set({ searches: FieldValue.increment(out.searched), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const searchesToday = usedBefore + out.searched;
  const processed = out.matched + out.noMatch;
  const remaining = todo.length - processed;
  if (!stopped && remaining > 0 && searchesToday >= dailyLimit) stopped = 'daily-limit';
  return {
    total: searchable.length,
    withoutCoordinates: candidates.length - searchable.length,
    saved: { ok: saved.ok + out.matched, noMatch: saved.noMatch + out.noMatch },
    thisCall: out,
    remaining,
    searchesToday,
    dailyLimit,
    done: remaining === 0,
    stopped,
  };
}
