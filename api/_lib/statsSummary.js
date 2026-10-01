import { FieldPath } from 'firebase-admin/firestore';
import { computeMetrics, growthStats } from '../../src/lib/adminStats.js';
import { computeStudy } from '../../src/lib/studySummary.js';
import { STUDY_COLLECTION, STUDY_SERIES_DAYS } from '../../src/lib/statsConstants.js';
import { loadStatsData } from './statsData.js';

// Totals only. Nothing built here may carry a uid, name, email or location.

export async function buildSummary(db, now = Date.now()) {
  const ds = await loadStatsData(db);
  const study = computeStudy(ds, now);
  const growth = growthStats(ds, now);
  const openDaysSeen = ds.openDays.length;
  return {
    generatedAt: now,
    metrics: computeMetrics(ds, now),
    growth: { start: growth.start, weeks: growth.weeks },
    totals: { users: ds.users.length, openDays: openDaysSeen },
    truncated: ds.truncated,
    study,
  };
}

// The stored daily points win over a recomputed series for the same date: an
// account deleted later removes its taste_history, which would otherwise
// rewrite the past.
export async function storedSeries(db) {
  const snap = await db.collection(STUDY_COLLECTION).orderBy(FieldPath.documentId(), 'desc').limit(STUDY_SERIES_DAYS).get();
  const out = new Map();
  for (const d of snap.docs) {
    const p = d.data()?.daily;
    if (p?.date) out.set(p.date, p);
  }
  return { points: out, days: snap.docs.length };
}

export function mergeSeries(live = [], stored = new Map()) {
  const byDate = new Map(live.map((p) => [p.date, p]));
  for (const [date, p] of stored) byDate.set(date, { date, mapr: p.mapr, baseline: p.baseline, users: p.users });
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-STUDY_SERIES_DAYS);
}

// The one document the daily job stores (study_summaries/{date}).
export function studyDocument(summary, date) {
  const last = summary.study.series[summary.study.series.length - 1];
  return {
    date,
    generatedAt: summary.generatedAt,
    totals: summary.totals,
    daily: last && last.date === date ? last : last ? { ...last, date } : { date, mapr: null, baseline: null, users: 0 },
    study: summary.study,
  };
}
