'use client';
import { useEffect, useState } from 'react';
import { collection, doc, limit as limitTo, onSnapshot, orderBy, query, type DocumentData, type Firestore } from 'firebase/firestore';
import { useFirebaseGate } from './FirebaseGate';
import { reportListenerError, reportListenerUpdate, reportPaint, reportSubscribed, reportUnsubscribed } from './listenerHealth';
import type { AccuracyDoc, AppMetrics, BigMiss, EngagementMetric, GrowthMetric, MaprMetric, MaprNCFModel, MaprSimilarity, RetentionCohort, TasteScore } from './types';

// Live Firestore listeners. Every hook returns { data, loading, error },
// logs its health (listenerHealth.ts), and unsubscribes on unmount. No
// polling: onSnapshot pushes each change, and Firestore charges reads only
// for documents that changed.

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

// The latest `n` docs of a collection ordered by `field` (newest last).
export function useLatestDocs<T>(name: string, field: string, n: number): Live<T[]> {
  const { db, ready } = useFirebaseGate();
  const [state, setState] = useState<Live<T[]>>({ data: [], loading: true, error: null });
  useEffect(() => {
    if (!ready || !db) return undefined;
    reportSubscribed(name);
    const unsubscribe = onSnapshot(
      query(collection(db as Firestore, name), orderBy(field, 'desc'), limitTo(n)),
      (snap) => {
        const t0 = performance.now();
        const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) }) as T).reverse();
        reportListenerUpdate(name, snap.docChanges().length);
        setState({ data: docs, loading: false, error: null });
        measurePaint(name, t0);
      },
      (err) => {
        reportListenerError(name, err.message);
        setState((s) => ({ ...s, loading: false, error: err.message }));
      }
    );
    return () => {
      unsubscribe();
      reportUnsubscribed(name);
    };
  }, [db, ready, name, field, n]);
  return state;
}

// One document, live.
export function useLiveDoc<T>(col: string, id: string): Live<T | null> {
  const { db, ready } = useFirebaseGate();
  const name = `${col}/${id}`;
  const [state, setState] = useState<Live<T | null>>({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!ready || !db) return undefined;
    reportSubscribed(name);
    const unsubscribe = onSnapshot(
      doc(db as Firestore, col, id),
      (snap) => {
        const t0 = performance.now();
        reportListenerUpdate(name, 1);
        setState({ data: snap.exists() ? (snap.data() as T) : null, loading: false, error: null });
        measurePaint(name, t0);
      },
      (err) => {
        reportListenerError(name, err.message);
        setState((s) => ({ ...s, loading: false, error: err.message }));
      }
    );
    return () => {
      unsubscribe();
      reportUnsubscribed(name);
    };
  }, [db, ready, col, id, name]);
  return state;
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
