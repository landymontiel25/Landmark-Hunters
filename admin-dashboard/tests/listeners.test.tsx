// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// The server answers /api/firestore-read; the test scripts each response.
type Call = { payload: Record<string, unknown> };
const calls: Call[] = [];
let respond: (payload: Record<string, unknown>) => { status: number; body: unknown } = () => ({ status: 200, body: { docs: [] } });
const fakeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
  const payload = JSON.parse(String(init?.body));
  calls.push({ payload });
  const { status, body } = respond(payload);
  return new Response(JSON.stringify(body), { status });
});

const { FirebaseGateValue } = await import('@/lib/FirebaseGate');
const { useGrowthMetrics, useMaprNCFModel, POLL_MS } = await import('@/lib/listeners');
const { _resetHealth, getHealth, healthSummary } = await import('@/lib/listenerHealth');
const { ErrorBoundary } = await import('@/components/ErrorBoundary');
const { MetricCard } = await import('@/components/MetricCard');

const wrapper = (ready = true) =>
  function W({ children }: { children: ReactNode }) {
    return <FirebaseGateValue value={{ ready, error: null }}>{children}</FirebaseGateValue>;
  };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  calls.length = 0;
  respond = () => ({ status: 200, body: { docs: [] } });
  vi.stubGlobal('fetch', fakeFetch);
  _resetHealth();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('server-read hooks', () => {
  it('fetch -> newest last -> re-read on the poll timer -> stop on unmount', async () => {
    vi.useFakeTimers();
    respond = () => ({ status: 200, body: { docs: [{ id: '2026-10-02', date: '2026-10-02', active_users: 2 }, { id: '2026-10-01', date: '2026-10-01', active_users: 1 }] } });
    const { result, unmount } = renderHook(() => useGrowthMetrics(30), { wrapper: wrapper() });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls[0].payload).toMatchObject({ kind: 'latest', col: 'growth_metrics', field: 'date', n: 30 });
    expect(result.current.loading).toBe(false);
    expect(getHealth().growth_metrics).toMatchObject({ subscribed: true, reads: 2, errors: 0 });
    respond = () => ({ status: 200, body: { docs: [{ id: '2026-10-03', date: '2026-10-03', active_users: 5 }] } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(result.current.data[0].active_users).toBe(5);
    unmount();
    expect(getHealth().growth_metrics.subscribed).toBe(false);
    const n = calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(calls.length).toBe(n);
  });

  it('turns { _ms } timestamps into objects with toMillis()', async () => {
    respond = () => ({ status: 200, body: { docs: [{ id: 'a', reported_at: { _ms: 1234 } }] } });
    const { result } = renderHook(() => useGrowthMetrics(1), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((result.current.data[0] as unknown as { reported_at: { toMillis: () => number } }).reported_at.toMillis()).toBe(1234);
  });

  it('reports a server error (Firestore down, key rejected) without throwing', async () => {
    respond = () => ({ status: 503, body: { error: 'Google refused the service-account key (invalid_grant).' } });
    const { result } = renderHook(() => useMaprNCFModel(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ error: 'Google refused the service-account key (invalid_grant).' });
    expect(getHealth()['mapr_ncf_model/current']).toMatchObject({ errors: 1 });
  });

  it('does not fetch before the server check is ready', () => {
    renderHook(() => useGrowthMetrics(), { wrapper: wrapper(false) });
    expect(calls).toHaveLength(0);
  });

  it('a missing doc is null, not an error', async () => {
    respond = () => ({ status: 200, body: { doc: null } });
    const { result } = renderHook(() => useMaprNCFModel(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ data: null, error: null });
  });
});

describe('AutoRefresh', () => {
  it('refreshes on open and every interval, counts down, never overlaps, and waits while hidden', async () => {
    vi.useFakeTimers();
    const { AutoRefresh, clock } = await import('@/components/AutoRefresh');
    expect(clock(272_000)).toBe('4:32');
    let release: () => void = () => {};
    const f = vi.fn(() => new Promise<Response>((res) => { release = () => res(new Response('{}', { status: 200 })); }));
    render(<AutoRefresh everyMs={10_000} fetchImpl={f as never} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(f).toHaveBeenCalledTimes(1); // on open
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ action: 'refresh' });
    expect(screen.getByTestId('auto-refresh').textContent).toContain('Refreshing');
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByTestId('auto-refresh').textContent).toMatch(/next in 0:0[5-9]|next in 0:10/);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(f).toHaveBeenCalledTimes(1); // hidden: waits
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(f).toHaveBeenCalledTimes(2); // catches up when shown
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(f).toHaveBeenCalledTimes(2); // still running: no overlap
  });
  it('says so when a refresh fails', async () => {
    vi.useFakeTimers();
    const { AutoRefresh } = await import('@/components/AutoRefresh');
    render(<AutoRefresh everyMs={60_000} fetchImpl={(async () => new Response('{}', { status: 503 })) as never} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByTestId('auto-refresh').textContent).toContain('Refresh failed');
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
