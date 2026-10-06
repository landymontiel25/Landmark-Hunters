import { FieldValue } from 'firebase-admin/firestore';
import { ALL_LANDMARKS } from '../../src/data/regions.js';
import { placeKinds } from '../../src/lib/placeKinds.js';
import { loadStatsData } from './statsData.js';
import {
  METRICS,
  METRICS_COLLECTION,
  MODEL_COLLECTION,
  NCF,
  SIMILARITY_COLLECTION,
  TRENDING_LIMIT,
  USER_MODEL_COLLECTION,
} from '../../src/lib/maprRank/config.js';
import { computeRegionSimilarity, encodeNeighbors, landmarkFeatures } from '../../src/lib/maprRank/similarity.js';
import { hasDrifted, pairwiseAccuracy, serializeModel, shouldPromote, trainNcf } from '../../src/lib/maprRank/ncf.js';
import { computeDailyReport, slackMessage, stagnatingUserIds } from '../../src/lib/maprRank/metrics.js';
import { slackAlerts } from '../../src/lib/dashboardMetrics.js';
import { writeDashboardDaily, writeDashboardModels } from './dashboardDocs.js';

// Mapr Phase 1 batch work, run by api/mapr-nightly.js with the Admin SDK.
//   daily   metrics report -> mapr_metrics/{date}, Slack, stagnation flags
//   weekly  similarity matrix per region -> mapr_similarity/{region}
//           NCF training -> mapr_models/ncf (+ ncf_prev), user embeddings ->
//           mapr_user_models/{uid}, trending -> mapr_models/signals
// Totals only in mapr_metrics; per-user data only in owner-only user docs.

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 400;
const dateUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const TIER_OK = new Set(NCF.positiveTiers);
const reviewAt = (r) => r.ratedAt ?? r.updatedAt ?? r.createdAt ?? null;

async function commitInBatches(db, writes) {
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + BATCH)) w(batch);
    await batch.commit();
  }
}

// Implicit positives for NCF: real check-ins plus "I loved it" ratings.
export function ncfPositives(ds) {
  const out = [];
  for (const c of ds.checkins || []) {
    if (c.ratingOnly === true || !c.region || !c.landmarkId || !Number.isFinite(c.createdAt)) continue;
    out.push({ userId: c.userId, itemKey: `${c.region}/${c.landmarkId}`, at: c.createdAt });
  }
  for (const r of ds.reviews || []) {
    if (!TIER_OK.has(r.ratingTier) || !r.region || !r.landmarkId || !Number.isFinite(reviewAt(r))) continue;
    out.push({ userId: r.userId, itemKey: `${r.region}/${r.landmarkId}`, at: reviewAt(r) });
  }
  return out;
}

// Week 2: one sparse matrix per region.
export function computeAllSimilarity(ds, { now = Date.now(), landmarks = ALL_LANDMARKS } = {}) {
  const started = Date.now();
  const byRegion = new Map();
  for (const l of landmarks) {
    if (!l?.regionId) continue;
    if (!byRegion.has(l.regionId)) byRegion.set(l.regionId, []);
    byRegion.get(l.regionId).push({ id: l.id, features: landmarkFeatures(l, placeKinds) });
  }
  const visits = (ds.checkins || []).filter((c) => c.ratingOnly !== true && c.region && c.landmarkId).map((c) => ({ userId: c.userId, landmarkId: c.landmarkId, region: c.region, at: c.createdAt }));
  const liked = (ds.reviews || []).filter((r) => TIER_OK.has(r.ratingTier) && r.region && r.landmarkId);
  const regions = {};
  for (const [region, list] of byRegion) {
    const res = computeRegionSimilarity({
      visits: visits.filter((v) => v.region === region),
      landmarks: list,
      rowOwners: liked.filter((r) => r.region === region).map((r) => r.landmarkId),
      now,
    });
    if (res.stats.rows) regions[region] = res;
  }
  return { regions, ms: Date.now() - started };
}

// Trending: real check-ins per place over the last 7 days.
export function trendingCounts(ds, now = Date.now(), limit = TRENDING_LIMIT) {
  const since = now - 7 * DAY_MS;
  const counts = new Map();
  for (const c of ds.checkins || []) {
    if (c.ratingOnly === true || !c.region || !c.landmarkId || !(c.createdAt >= since)) continue;
    const k = `${c.region}/${c.landmarkId}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit));
}

// The live model's accuracy on this week's data, scored with its own
// embeddings (drift check). Null when it cannot score enough of it.
export function liveAccuracy(live, userEmbeddings, positives, { now = Date.now(), cfg = NCF } = {}) {
  if (!live?.layers || !live?.items) return null;
  const items = Object.keys(live.items);
  if (items.length < 2) return null;
  const since = now - cfg.split.test * cfg.windowDays * DAY_MS;
  const fresh = positives.filter((p) => p.at >= since && userEmbeddings[p.userId] && live.items[p.itemKey]);
  if (!fresh.length) return null;
  // A throwaway model object in the trainer's shape: one user row per scored user.
  const users = [...new Set(fresh.map((p) => p.userId))];
  const uIdx = new Map(users.map((u, n) => [u, n]));
  const iIdx = new Map(items.map((k, n) => [k, n]));
  const d = live.dim;
  const model = {
    dim: d,
    U: Float64Array.from(users.flatMap((u) => userEmbeddings[u])),
    I: Float64Array.from(items.flatMap((k) => live.items[k])),
    layers: live.layers.map((l) => ({ in: l.in, out: l.out, W: Float64Array.from(l.W), b: Float64Array.from(l.b) })),
  };
  const own = new Map();
  for (const p of positives) {
    if (!uIdx.has(p.userId) || !iIdx.has(p.itemKey)) continue;
    if (!own.has(p.userId)) own.set(p.userId, new Set());
    own.get(p.userId).add(iIdx.get(p.itemKey));
  }
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const triples = [];
  for (const p of fresh) {
    const u = uIdx.get(p.userId);
    for (let n = 0; n < cfg.negativesPerPositive; n++) {
      const j = Math.floor(rand() * items.length);
      if (!own.get(p.userId)?.has(j)) triples.push([u, iIdx.get(p.itemKey), j]);
    }
  }
  return pairwiseAccuracy(model, triples);
}

async function readUserModels(db) {
  const snap = await db.collection(USER_MODEL_COLLECTION).get();
  const out = {};
  for (const d of snap.docs) out[d.id] = d.data() || {};
  return out;
}

// Users with at least one positive (real check-in or loved rating) in the
// training window: the count behind NCF's on/off switch.
export function ncfActiveUsers(positives, { now = Date.now(), windowDays = NCF.windowDays } = {}) {
  const since = now - windowDays * DAY_MS;
  return new Set(positives.filter((p) => p.at >= since && p.at <= now).map((p) => p.userId)).size;
}

// Week 3: train, then promote / keep / roll back. Whatever ends up live gets
// `active` (more than NCF.autoEnableAboveUsers users) and `activeUsers`.
export async function runNcfWeekly(db, ds, { now = Date.now(), cfg = NCF } = {}) {
  const positives = ncfPositives(ds);
  const activeUsers = ncfActiveUsers(positives, { now, windowDays: cfg.windowDays });
  const active = activeUsers > cfg.autoEnableAboveUsers;
  const gate = { active, activeUsers, activeThreshold: cfg.autoEnableAboveUsers };
  const out = await trainAndPublish(db, positives, { now, cfg, gate });
  const live = await db.collection(MODEL_COLLECTION).doc('ncf').get();
  if (live.exists) await db.collection(MODEL_COLLECTION).doc('ncf').set(gate, { merge: true });
  return { ...out, ...gate };
}

async function trainAndPublish(db, positives, { now, cfg, gate }) {
  const result = trainNcf(positives, { now, cfg, budgetMs: cfg.trainBudgetMs });
  const ref = db.collection(MODEL_COLLECTION);
  const liveSnap = await ref.doc('ncf').get();
  const live = liveSnap.exists ? liveSnap.data() : null;
  const userDocs = await readUserModels(db);
  const summary = { trainedAt: now, counts: result.counts, ok: result.ok, reason: result.reason ?? null, evaluation: result.evaluation ? { ...result.evaluation, history: undefined } : null };
  if (!result.ok) return { action: 'skipped', ...summary };

  const newAcc = result.evaluation.testAccuracy;
  const prevAcc = live?.evaluation?.testAccuracy ?? null;
  if (!shouldPromote(newAcc, prevAcc, cfg.maxTestDrop)) {
    // Not promoted. If the live model itself has drifted, fall back a week.
    const liveEmb = Object.fromEntries(Object.entries(userDocs).map(([u, d]) => [u, d.byVersion?.[live?.version]]).filter(([, e]) => Array.isArray(e)));
    const liveAcc = liveAccuracy(live, liveEmb, positives, { now, cfg });
    if (hasDrifted(liveAcc, prevAcc, cfg.maxDriftDrop)) {
      const prev = await ref.doc('ncf_prev').get();
      if (prev.exists) {
        await ref.doc('ncf').set({ ...prev.data(), rolledBackAt: now, rolledBackFrom: live?.version ?? null });
        return { action: 'rolled-back', liveAcc, ...summary };
      }
    }
    return { action: 'kept-previous', liveAcc, ...summary };
  }

  const version = `v${now}`;
  const { shared, users } = serializeModel(result, { meta: { version, trainedAt: now, evaluation: summary.evaluation, counts: result.counts, ...gate } });
  if (live) await ref.doc('ncf_prev').set(live);
  await ref.doc('ncf').set(JSON.parse(JSON.stringify(shared)));
  const writes = Object.entries(users).map(([uid, emb]) => (batch) => {
    const prior = userDocs[uid]?.byVersion || {};
    const keep = Object.keys(prior).sort().slice(-(cfg.keepVersions - 1));
    const byVersion = { ...Object.fromEntries(keep.map((v) => [v, prior[v]])), [version]: emb };
    batch.set(db.collection(USER_MODEL_COLLECTION).doc(uid), { byVersion, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  await commitInBatches(db, writes);
  return { action: 'promoted', version, users: Object.keys(users).length, ...summary };
}

export async function runSimilarityWeekly(db, ds, { now = Date.now(), landmarks = ALL_LANDMARKS } = {}) {
  const { regions, ms } = computeAllSimilarity(ds, { now, landmarks });
  const stats = {};
  let sizeBytes = 0;
  let top = null;
  for (const [region, res] of Object.entries(regions)) {
    const { json, keptPerRow } = encodeNeighbors(res.neighbors);
    await db.collection(SIMILARITY_COLLECTION).doc(region).set({ neighbors: json, keptPerRow, computedAt: now, stats: res.stats });
    stats[region] = { ...res.stats, keptPerRow };
    sizeBytes += json.length;
    for (const [id, row] of Object.entries(res.neighbors)) if (!top || row.length > top.neighbors) top = { region, id, neighbors: row.length };
  }
  return { computedAt: now, ms, regions: stats, sizeBytes, top };
}

export async function runWeekly(db, { now = Date.now(), ds = null, landmarks = ALL_LANDMARKS } = {}) {
  const data = ds || (await loadStatsData(db));
  const similarity = await runSimilarityWeekly(db, data, { now, landmarks });
  const ncf = await runNcfWeekly(db, data, { now });
  await db.collection(MODEL_COLLECTION).doc('signals').set({ trending: trendingCounts(data, now), computedAt: now });
  const status = JSON.parse(JSON.stringify({ similarity: { computedAt: similarity.computedAt, ms: similarity.ms, regions: Object.keys(similarity.regions).length }, ncf }));
  await db.collection(MODEL_COLLECTION).doc('status').set({ ...status, updatedAt: now });
  await writeDashboardModels(db, { ncf, similarity }, { now });
  return status;
}

// Last few daily reports, oldest first (the trend).
async function recentReports(db, before, days = METRICS.trendDays) {
  const snap = await db.collection(METRICS_COLLECTION).orderBy('date', 'desc').limit(days + 1).get();
  return snap.docs.map((d) => d.data()).filter((r) => r?.date && r.date < before).slice(0, days).reverse();
}

export async function postToSlack(text, { url = process.env.SLACK_WEBHOOK_URL, fetchImpl = globalThis.fetch } = {}) {
  if (!url) return { posted: false, reason: 'SLACK_WEBHOOK_URL is not set' };
  try {
    const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    return { posted: r.ok, status: r.status };
  } catch (e) {
    return { posted: false, reason: String(e?.message || e) };
  }
}

export async function runDaily(db, { now = Date.now(), ds = null, slack = postToSlack } = {}) {
  const data = ds || (await loadStatsData(db));
  const statusSnap = await db.collection(MODEL_COLLECTION).doc('status').get();
  const status = statusSnap.exists ? statusSnap.data() : {};
  data.models = { ncf: status.ncf ? { trainedAt: status.ncf.action === 'promoted' ? status.ncf.trainedAt : null, evaluation: status.ncf.evaluation, version: status.ncf.version } : null, similarity: status.similarity || null };
  // A model kept from an earlier week still counts as trained then.
  if (data.models.ncf && !data.models.ncf.trainedAt) {
    const live = await db.collection(MODEL_COLLECTION).doc('ncf').get();
    if (live.exists) data.models.ncf.trainedAt = live.data().trainedAt ?? null;
  }
  const date = dateUtc(now - DAY_MS);
  const report = computeDailyReport(data, { date, now });
  const clean = JSON.parse(JSON.stringify(report));
  await db.collection(METRICS_COLLECTION).doc(date).set({ ...clean, createdAt: FieldValue.serverTimestamp() });
  const trend = await recentReports(db, date);
  // The admin dashboard's collections (api/_lib/dashboardDocs.js).
  let dashboardWrites = 0;
  try {
    dashboardWrites = await writeDashboardDaily(db, data, report, { now });
  } catch (e) {
    console.error('dashboard docs failed:', e?.message || e);
  }
  const extra = slackAlerts(report, trend[trend.length - 1], status.ncf);
  const link = process.env.DASHBOARD_URL ? `\n<${process.env.DASHBOARD_URL}/dashboard|Open the dashboard>` : '';
  const slackResult = await slack(slackMessage(report, trend) + (extra.length ? `\n:rotating_light: ${extra.join('\n:rotating_light: ')}` : '') + link);

  // Stagnation flags, owner-only (the app raises epsilon and offers "Shake
  // things up?"). Cleared for users who are no longer stagnating.
  const flagged = new Set(stagnatingUserIds(data, now));
  const existing = await db.collection(USER_MODEL_COLLECTION).where('stagnating', '==', true).get();
  const writes = [];
  const already = new Set(existing.docs.map((d) => d.id));
  for (const d of existing.docs) if (!flagged.has(d.id)) writes.push((b) => b.set(d.ref, { stagnating: false }, { merge: true }));
  for (const uid of flagged) if (!already.has(uid)) writes.push((b) => b.set(db.collection(USER_MODEL_COLLECTION).doc(uid), { stagnating: true, stagnatingSince: now }, { merge: true }));
  await commitInBatches(db, writes);
  return { date, shown: report.totals.shown, alerts: report.alerts.length + extra.length, slack: slackResult, stagnating: flagged.size, dashboardWrites };
}
