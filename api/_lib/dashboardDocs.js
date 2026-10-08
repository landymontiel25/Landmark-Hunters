import { FieldValue } from 'firebase-admin/firestore';
import { getLandmark } from '../../src/data/regions.js';
import { computeMetrics } from '../../src/lib/adminStats.js';
import { computeStudy } from '../../src/lib/studySummary.js';
import { annotateShown } from '../../src/lib/maprRank/metrics.js';
import {
  accuracyDocs,
  bigMissDocs,
  dateUtc,
  engagementDocs,
  growthDocs,
  lastDates,
  maprFlatFields,
  retentionDocs,
  tasteDocs,
} from '../../src/lib/dashboardMetrics.js';

// Writes what the separate admin dashboard (admin-dashboard/) shows, every
// night after the Mapr report (api/_lib/maprNightly.js). Firestore rules let
// only the dashboard's own sign-in read these; no app user can.
//
//   growth_metrics/{date}, engagement_metrics/{date}, taste_score/{date}
//                                   the last DASHBOARD_DAYS days, recomputed
//   retention_cohorts/{signup date} the last DASHBOARD_COHORTS signup days
//   accuracy_by_category/{date}, accuracy_by_city/{date}
//   big_misses/{region__id}          stats merged in; reviewed/resolution kept
//   app_metrics/latest               the old in-app admin stats (cards + study)
//   mapr_metrics/{date}              gets the dashboard's flat fields
//   mapr_ncf_model/current, mapr_similarity_matrix/current (weekly + latency)

export const DASHBOARD_DAYS = 30;
// 91 so the oldest cohort is past day 90 (and day 30): with 30, day 30 was
// always tomorrow and the 30/90-day numbers stayed empty.
export const DASHBOARD_COHORTS = 91;
const BATCH = 400;

async function writeAll(db, writes) {
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = db.batch();
    for (const [col, id, data, opts] of writes.slice(i, i + BATCH)) batch.set(db.collection(col).doc(id), data, opts || {});
    await batch.commit();
  }
}

const clean = (o) => JSON.parse(JSON.stringify(o));

// big_misses ids come from client-written recommendation_log fields (rules
// only check they are strings). A '/' would make doc() throw and lose every
// dashboard doc that night, so it is swapped out; ids are also kept under
// Firestore's 1500-byte limit.
export const safeDocId = (id) => String(id).replace(/\//g, '_').slice(0, 500);

export async function writeDashboardDaily(db, ds, report, { now = Date.now() } = {}) {
  const ts = FieldValue.serverTimestamp();
  const yesterday = report.date;
  const dates = lastDates(yesterday, DASHBOARD_DAYS);
  const annotated = annotateShown(ds);
  const writes = [];
  for (const d of growthDocs(ds, dates)) writes.push(['growth_metrics', d.date, { ...d, createdAt: ts }]);
  for (const d of engagementDocs(ds, dates, annotated)) writes.push(['engagement_metrics', d.date, { ...d, createdAt: ts }]);
  for (const d of tasteDocs(ds, dates)) writes.push(['taste_score', d.date, { ...d, createdAt: ts }]);
  for (const d of retentionDocs(ds, lastDates(dateUtc(now), DASHBOARD_COHORTS), now)) writes.push(['retention_cohorts', d.cohort_date, { ...clean(d), createdAt: ts }]);
  const acc = accuracyDocs(ds, yesterday, { annotated });
  writes.push(['accuracy_by_category', yesterday, { ...clean(acc.byCategory), createdAt: ts }]);
  writes.push(['accuracy_by_city', yesterday, { ...clean(acc.byCity), createdAt: ts }]);
  for (const m of bigMissDocs(ds, (region, id) => getLandmark(region, id)?.name || null, annotated)) {
    const { id, ...stats } = m;
    writes.push(['big_misses', safeDocId(id), { ...clean(stats), reported_at: ts }, { merge: true }]);
  }
  writes.push(['mapr_metrics', yesterday, clean(maprFlatFields(report)), { merge: true }]);
  writes.push(['mapr_ncf_model', 'current', { last_inference_latency_ms: report.latency?.p99Ms ?? null, latency_date: yesterday }, { merge: true }]);
  writes.push(['app_metrics', 'latest', { ...clean({ generatedAt: now, date: yesterday, metrics: computeMetrics(ds, now), study: computeStudy(ds, now), truncated: ds.truncated || [] }), createdAt: ts }]);
  await writeAll(db, writes);
  return writes.length;
}

// After the weekly models: the NCF and similarity status docs.
export async function writeDashboardModels(db, { ncf, ncfV2 = null, similarity }, { now = Date.now() } = {}) {
  const ev = ncf?.evaluation || {};
  const ev2 = ncfV2?.evaluation || {};
  const writes = [
    [
      'mapr_ncf_model',
      'current',
      clean({
        // Left out when the week kept the old model, so the merge keeps the
        // date it was really trained (same as v2 below).
        ...(ncf?.action === 'promoted' ? { last_trained: now } : {}),
        last_run: now,
        last_action: ncf?.action ?? null,
        training_loss: ev.bestValLoss ?? null,
        validation_accuracy: ev.valAccuracy ?? null,
        test_accuracy: ev.testAccuracy ?? null,
        model_version: ncf?.version ?? null,
        active: ncf?.active === true,
        active_users: ncf?.activeUsers ?? null,
        active_threshold: ncf?.activeThreshold ?? null,
        stopped_by: ev.stoppedBy ?? null,
        train_ms: ev.trainMs ?? null,
        // The same holdout scored against any place and against places in
        // the same region, so v1 and v2 compare like for like.
        test_accuracy_catalog: ev.testAccuracyCatalog ?? ev.testAccuracy ?? null,
        test_accuracy_region: ev.testAccuracyRegion ?? null,
        // Mapr v2 (mapr_models/ncf_v2), null while its rollout is off.
        v2: ncfV2
          ? {
              // Left out when the week kept the old model, so the merge keeps
              // the date it was really trained.
              ...(ncfV2.action === 'promoted' ? { last_trained: now } : {}),
              last_run: now,
              last_action: ncfV2.action ?? null,
              validation_accuracy: ev2.valAccuracy ?? null,
              test_accuracy_catalog: ev2.testAccuracyCatalog ?? null,
              test_accuracy_region: ev2.testAccuracyRegion ?? ev2.testAccuracy ?? null,
              model_version: ncfV2.version ?? null,
              active: ncfV2.active === true,
              stopped_by: ev2.stoppedBy ?? null,
              best_epoch: ev2.bestEpoch ?? null,
              train_ms: ev2.trainMs ?? null,
            }
          : null,
      }),
      { merge: true },
    ],
    [
      'mapr_similarity_matrix',
      'current',
      clean({
        last_computed: similarity?.computedAt ?? now,
        compute_ms: similarity?.ms ?? null,
        model_size_bytes: similarity?.sizeBytes ?? 0,
        regions: similarity?.regions ? Object.keys(similarity.regions).length : 0,
        top_landmark: similarity?.top || null,
      }),
    ],
  ];
  await writeAll(db, writes);
}
