// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// A fake onSnapshot that the test drives: each subscription is recorded, and
// emit() pushes a snapshot (or an error) to it, like Firestore would.
type Sub = { path: string; next: (s: unknown) => void; error: (e: Error) => void; unsubscribed: boolean };
const subs: Sub[] = [];
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ path: name }),
  doc: (_db: unknown, col: string, id: string) => ({ path: `${col}/${id}`, isDoc: true }),
  query: (c: { path: string }) => c,
  orderBy: () => ({}),
  limit: () => ({}),
  onSnapshot: (ref: { path: string }, next: Sub['next'], error: Sub['error']) => {
    const s: Sub = { path: ref.path, next, error, unsubscribed: false };
    subs.push(s);
    return () => {
      s.unsubscribed = true;
    };
  },
}));

const { FirebaseGateValue } = await import('@/lib/FirebaseGate');
const { useGrowthMetrics, useMaprNCFModel } = await import('@/lib/listeners');
const { _resetHealth, getHealth, healthSummary } = await import('@/lib/listenerHealth');
const { ErrorBoundary } = await import('@/components/ErrorBoundary');
const { MetricCard } = await import('@/components/MetricCard');

const querySnap = (rows: Record<string, unknown>[]) => ({
  docs: rows.map((r) => ({ id: String(r.date), data: () => r })),
  docChanges: () => rows,
});
const wrapper = (ready = true) =>
  function W({ children }: { children: ReactNode }) {
    return <FirebaseGateValue value={{ db: ready ? ({} as never) : null, ready, error: null }}>{children}</FirebaseGateValue>;
  };

afterEach(() => cleanup());
beforeEach(() => {
  subs.length = 0;
  _resetHealth();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('live listener hooks', () => {
  it('subscribe → snapshot → newest last → unsubscribe on unmount', () => {
    const { result, unmount } = renderHook(() => useGrowthMetrics(30), { wrapper: wrapper() });
    expect(result.current.loading).toBe(true);
    expect(subs[0].path).toBe('growth_metrics');
    act(() => subs[0].next(querySnap([{ date: '2026-10-02', active_users: 2 }, { date: '2026-10-01', active_users: 1 }])));
    expect(result.current.loading).toBe(false);
    expect(result.current.data.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02']);
    expect(getHealth().growth_metrics).toMatchObject({ subscribed: true, reads: 2, errors: 0 });
    // A later change arrives on its own: no polling.
    act(() => subs[0].next(querySnap([{ date: '2026-10-03', active_users: 5 }])));
    expect(result.current.data[0].active_users).toBe(5);
    unmount();
    expect(subs[0].unsubscribed).toBe(true);
    expect(getHealth().growth_metrics.subscribed).toBe(false);
  });

  it('reports a listener error (Firestore down, rules) without throwing', () => {
    const { result } = renderHook(() => useMaprNCFModel(), { wrapper: wrapper() });
    act(() => subs[0].error(new Error('Missing or insufficient permissions.')));
    expect(result.current).toMatchObject({ loading: false, error: 'Missing or insufficient permissions.' });
    expect(getHealth()['mapr_ncf_model/current']).toMatchObject({ errors: 1, subscribed: false });
  });

  it('does not subscribe before the Firebase sign-in is ready', () => {
    renderHook(() => useGrowthMetrics(), { wrapper: wrapper(false) });
    expect(subs).toHaveLength(0);
  });

  it('load: 10 open dashboards x 4 listeners take a 30-day update each well under 200 ms', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, active_users: i }));
    for (let i = 0; i < 40; i++) renderHook(() => useGrowthMetrics(30), { wrapper: wrapper() });
    expect(subs).toHaveLength(40);
    const t0 = performance.now();
    act(() => {
      for (const s of subs) s.next(querySnap(rows));
    });
    const ms = performance.now() - t0;
    expect(ms / 40).toBeLessThan(200);
    expect(healthSummary().reads).toBe(1200);
  });
});

describe('components', () => {
  it('ErrorBoundary shows a fallback instead of crashing the page', () => {
    const Boom = () => {
      throw new Error('bad data');
    };
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert').textContent).toContain('bad data');
  });

  it('MetricCard: value, trend wording, loading and error states', () => {
    const { rerender } = render(<MetricCard title="Skip rate" value="25%" trend={{ value: 10, direction: 'up' }} upIsGood={false} />);
    expect(screen.getByLabelText('Skip rate').textContent).toContain('↑ 10.0%');
    rerender(<MetricCard title="Skip rate" value="25%" loading />);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    rerender(<MetricCard title="Skip rate" value="25%" error="offline" />);
    expect(screen.getByRole('alert').textContent).toContain('offline');
  });
});
