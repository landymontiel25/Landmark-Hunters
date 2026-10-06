import { FieldPath } from 'firebase-admin/firestore';
import { STATS_MAX_DOCS, STATS_PAGE_SIZE } from '../../src/lib/statsConstants.js';

// Reads what the admin stats and the study summary need, with the Admin SDK
// (which bypasses Firestore rules), in bounded batches. Each collection is
// read STATS_PAGE_SIZE docs at a time and stops at STATS_MAX_DOCS (then it is
// listed in `truncated`). Only the fields the calculators use are kept, as
// plain numbers/strings; names, emails, photos and locations are never copied.

const ms = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  if (v && typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
};

// Pages through a query ordered by document id.
export async function readAll(baseQuery, pick, { pageSize = STATS_PAGE_SIZE, maxDocs = STATS_MAX_DOCS } = {}) {
  const rows = [];
  let truncated = false;
  let last = null;
  for (;;) {
    let q = baseQuery.orderBy(FieldPath.documentId()).limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) rows.push(pick(d));
    if (snap.docs.length < pageSize) break;
    last = snap.docs[snap.docs.length - 1];
    if (rows.length >= maxDocs) {
      truncated = true;
      break;
    }
  }
  return { rows, truncated };
}

const parentId = (d) => d.ref?.parent?.parent?.id ?? null;

export async function loadStatsData(db) {
  const truncated = [];
  const take = async (name, query, pick) => {
    const r = await readAll(query, pick);
    if (r.truncated) truncated.push(name);
    return r.rows;
  };
  const [users, openDays, reviews, pickFeedback, recommendationLog, checkins, referrals, placeScores, tasteHistory] = await Promise.all([
    take('users', db.collection('users'), (d) => ({ uid: d.id, createdAt: ms(d.data().createdAt) })),
    take('open_days', db.collectionGroup('open_days'), (d) => ({ uid: parentId(d), date: d.id })),
    take('reviews', db.collection('reviews'), (d) => {
      const x = d.data();
      return {
        userId: x.userId,
        landmarkId: x.landmarkId,
        ratingTier: x.ratingTier,
        ratedAt: ms(x.ratedAt),
        updatedAt: ms(x.updatedAt),
        createdAt: ms(x.createdAt),
        pickSetId: x.pickSetId,
        region: x.region ?? null,
        disagreement: x.disagreement ? { reason: x.disagreement.reason } : null,
      };
    }),
    take('pick_feedback', db.collection('pick_feedback'), (d) => {
      const x = d.data();
      return { userId: x.userId, landmarkId: x.landmarkId, verdict: x.verdict, at: ms(x.at), pickSetId: x.pickSetId };
    }),
    take('recommendation_log', db.collection('recommendation_log'), (d) => {
      const x = d.data();
      return {
        userId: x.userId,
        landmarkId: x.landmarkId,
        region: x.region,
        setId: x.setId,
        shownAt: ms(x.shownAt),
        predicted: x.predicted ?? null,
        pickType: x.pickType ?? null,
        requestFor: x.requestFor,
        isTest: x.isTest === true,
        categories: Array.isArray(x.categories) ? x.categories.slice(0, 3) : [],
        // Mapr Phase 1 telemetry (src/lib/recommendationLog.js telemetryFields).
        ...(x.telemetry === true
          ? {
              distanceKm: x.distanceKm ?? null,
              scoreBeforeDecay: x.scoreBeforeDecay ?? null,
              scoreAfterDecay: x.scoreAfterDecay ?? null,
              collabBoost: x.collabBoost ?? null,
              ncfScore: x.ncfScore ?? null,
              finalScore: x.finalScore ?? null,
              explore: x.explore === true,
              noveltyScore: x.noveltyScore ?? null,
              epsilon: x.epsilon ?? null,
              rankLatencyMs: x.rankLatencyMs ?? null,
              revisit: x.revisit === true,
              fallbacks: Array.isArray(x.fallbacks) ? x.fallbacks : [],
              variants: x.variants && typeof x.variants === 'object' ? x.variants : null,
            }
          : {}),
      };
    }),
    take('checkins', db.collection('checkins'), (d) => {
      const x = d.data();
      return { userId: x.userId, createdAt: ms(x.createdAt), ratingOnly: x.ratingOnly === true, landmarkId: x.landmarkId ?? null, region: x.region ?? null };
    }),
    take('referrals', db.collection('referrals'), (d) => ({ referrerUid: d.data().referrerUid, referredUid: d.data().referredUid })),
    take('place_scores', db.collectionGroup('place_scores'), (d) => {
      const x = d.data();
      return {
        userId: parentId(d),
        landmarkId: x.landmarkId,
        region: x.region,
        categories: x.categories,
        latestLevel: x.latestLevel,
        latestAt: ms(x.latestAt),
        ratingAt: ms(x.ratingAt),
        missWeight: x.missWeight,
        outcome: x.outcome,
      };
    }),
    take('taste_history', db.collectionGroup('taste_history'), (d) => {
      const x = d.data();
      return { userId: parentId(d), at: ms(x.at), score: x.score ?? null, baselineScore: x.baselineScore ?? null, ratingsCount: x.ratingsCount };
    }),
  ]);
  return { users, openDays, reviews, pickFeedback, recommendationLog, checkins, referrals, placeScores, tasteHistory, truncated };
}
