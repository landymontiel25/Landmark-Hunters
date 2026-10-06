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
export const DASHBOARD_COHORTS = 30;
const BATCH = 400;

async function writeAll(db, writes) {
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = db.batch();
    for (const [col, id, data, opts] of writes.slice(i, i + BATCH)) batch.set(db.collection(col).doc(id), data, opts || {});
    await batch.commit();
  }
}

const clean = (o) => JSON.parse(JSON.stringify(o));

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
    writes.push(['big_misses', id, { ...clean(stats), reported_at: ts }, { merge: true }]);
  }
  writes.push(['mapr_metrics', yesterday, clean(maprFlatFields(report)), { merge: true }]);
  writes.push(['mapr_ncf_model', 'current', { last_inference_latency_ms: report.latency?.p99Ms ?? null, latency_date: yesterday }, { merge: true }]);
  writes.push(['app_metrics', 'latest', { ...clean({ generatedAt: now, date: yesterday, metrics: computeMetrics(ds, now), study: computeStudy(ds, now), truncated: ds.truncated || [] }), createdAt: ts }]);
  await writeAll(db, writes);
  return writes.length;
}

// After the weekly models: the NCF and similarity status docs.
export async function writeDashboardModels(db, { ncf, similarity }, { now = Date.now() } = {}) {
  const ev = ncf?.evaluation || {};
  const writes = [
    [
      'mapr_ncf_model',
      'current',
      clean({
        last_trained: ncf?.action === 'promoted' ? now : null,
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
