'use client';
import { useEffect, useState } from 'react';
import { useFirebaseGate } from './FirebaseGate';
import { redirectIfSignedOut } from './session';
import { reportListenerError, reportListenerUpdate, reportPaint, reportSubscribed, reportUnsubscribed } from './listenerHealth';
import type { AccuracyDoc, AppMetrics, BigMiss, EngagementMetric, GrowthMetric, MaprMetric, MaprNCFModel, MaprSimilarity, RetentionCohort, TasteScore } from './types';

// Live hooks. Every hook returns { data, loading, error }, logs its health
// (listenerHealth.ts), and stops on unmount. The server reads Firestore
// (/api/firestore-read); the nightly job writes once a day, so each hook
// re-reads every POLL_MS and on window focus.

export const POLL_MS = 60_000;

export interface Live<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

// Snapshot-to-paint time: measured on the frame after the state update.
function measurePaint(name: string, t0: number) {
  if (typeof requestAnimationFrame === 'undefined') return;
  requestAnimationFrame(() => reportPaint(name, performance.now() - t0));
}

// Timestamps come back as { _ms }; give them the toMillis() the pages use.
function revive(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o._ms === 'number' && Object.keys(o).length === 1) return { toMillis: () => o._ms as number };
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, revive(x)]));
  }
  return v;
}

async function ask(payload: Record<string, unknown>, fetchImpl: typeof fetch = fetch) {
  const r = await fetchImpl('/api/firestore-read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  redirectIfSignedOut(r.status);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Firestore read failed (${r.status}).`);
  return body;
}

// Runs `load` now, every POLL_MS, and when the tab regains focus.
function usePolled<T>(name: string, ready: boolean, initial: T, load: () => Promise<{ value: T; changes: number }>, deps: unknown[]): Live<T> {
  const [state, setState] = useState<Live<T>>({ data: initial, loading: true, error: null });
  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    reportSubscribed(name);
    const run = async () => {
      try {
        const { value, changes } = await load();
        if (!alive) return;
        const t0 = performance.now();
        reportListenerUpdate(name, changes);
        setState({ data: value, loading: false, error: null });
        measurePaint(name, t0);
      } catch (e) {
        if (!alive) return;
        const message = (e as Error).message;
        reportListenerError(name, message);
        setState((s) => ({ ...s, loading: false, error: message }));
      }
    };
    run();
    const timer = setInterval(run, POLL_MS);
    const onFocus = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
      reportUnsubscribed(name);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, name, ...deps]);
  return state;
}

// The latest `n` docs of a collection ordered by `field` (newest last).
export function useLatestDocs<T>(name: string, field: string, n: number): Live<T[]> {
  const { ready } = useFirebaseGate();
  return usePolled<T[]>(name, ready, [], async () => {
    const { docs } = await ask({ kind: 'latest', col: name, field, n });
    return { value: revive(docs) as T[], changes: docs.length };
  }, [field, n]);
}

// One document.
export function useLiveDoc<T>(col: string, id: string): Live<T | null> {
  const { ready } = useFirebaseGate();
  return usePolled<T | null>(`${col}/${id}`, ready, null, async () => {
    const { doc } = await ask({ kind: 'doc', col, id });
    return { value: doc ? (revive(doc) as T) : null, changes: doc ? 1 : 0 };
  }, [col, id]);
}

// The spec's hooks.
export const useMaprMetrics = (days = 7) => useLatestDocs<MaprMetric>('mapr_metrics', 'date', days);
export const useGrowthMetrics = (days = 30) => useLatestDocs<GrowthMetric>('growth_metrics', 'date', days);
export const useEngagementMetrics = (days = 30) => useLatestDocs<EngagementMetric>('engagement_metrics', 'date', days);
export const useRetentionCohorts = (n = 30) => useLatestDocs<RetentionCohort>('retention_cohorts', 'cohort_date', n);
export const useAccuracyByCategory = () => useLatestDocs<AccuracyDoc>('accuracy_by_category', 'date', 1);
export const useAccuracyByCity = () => useLatestDocs<AccuracyDoc>('accuracy_by_city', 'date', 1);
export const useTasteScores = (days = 30) => useLatestDocs<TasteScore>('taste_score', 'date', days);
export const useBigMisses = (n = 100) => useLatestDocs<BigMiss>('big_misses', 'skip_count', n);
export const useMaprNCFModel = () => useLiveDoc<MaprNCFModel>('mapr_ncf_model', 'current');
export const useMaprSimilarity = () => useLiveDoc<MaprSimilarity>('mapr_similarity_matrix', 'current');
export const useAppMetrics = () => useLiveDoc<AppMetrics>('app_metrics', 'latest');
