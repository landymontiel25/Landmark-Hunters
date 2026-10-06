'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// Rebuilds the dashboard numbers by itself while a dashboard tab is open: one
// light "refresh" job (no model training, no Slack message) when the page
// opens and then every 5 minutes, one at a time, with a countdown so a viewer
// sees when the next one lands. A hidden tab waits and catches up when shown.
// The pages pick the new numbers up on their own 60-second read. The Tools
// page's "Mapr: run now" stays manual: it retrains the models and posts to
// Slack.
export const AUTO_REFRESH_MS = 5 * 60_000;

export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function AutoRefresh({ everyMs = AUTO_REFRESH_MS, fetchImpl = fetch }: { everyMs?: number; fetchImpl?: typeof fetch }) {
  const [now, setNow] = useState(() => Date.now());
  const [nextAt, setNextAt] = useState(() => Date.now());
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const nextAtRef = useRef(nextAt);
  nextAtRef.current = nextAt;

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    try {
      const r = await fetchImpl('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh' }) });
      setFailed(!r.ok);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setRunning(false);
      setNextAt(Date.now() + everyMs);
    }
  }, [everyMs, fetchImpl]);

  useEffect(() => {
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= nextAtRef.current && document.visibilityState === 'visible') void refresh();
    }, 1000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <p className="text-xs muted tabular" role="status" aria-live="off" data-testid="auto-refresh">
      <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${running ? '' : 'live-dot'}`} style={{ background: failed ? 'var(--critical)' : 'var(--good-mark)' }} aria-hidden="true" />
      {running ? 'Refreshing numbers…' : failed ? `Refresh failed, retrying in ${clock(nextAt - now)}` : `Numbers refresh automatically · next in ${clock(nextAt - now)}`}
    </p>
  );
}
