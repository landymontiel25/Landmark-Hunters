'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getHealth, healthSummary, subscribeHealth } from '@/lib/listenerHealth';
import { useFirebaseGate } from '@/lib/FirebaseGate';

// "Live" when every open listener is subscribed, with the time since the
// last update. `detail` lists each listener's health.
export function RealtimeStatus({ detail = false }: { detail?: boolean }) {
  const health = useSyncExternalStore(subscribeHealth, getHealth, getHealth);
  const { ready, error } = useFirebaseGate();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);
  const s = healthSummary(health, now);
  const live = ready && !error && (s.listeners === 0 || s.allLive);
  const age = s.ageMs == null ? null : s.ageMs < 60000 ? 'just now' : `${Math.round(s.ageMs / 60000)} min ago`;
  return (
    <div className="text-sm">
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        <span className={`inline-block w-2 h-2 rounded-full ${live ? 'live-dot' : ''}`} style={{ background: live ? 'var(--good-mark)' : 'var(--axis)' }} aria-hidden="true" />
        <span style={{ color: live ? 'var(--good)' : 'var(--text-secondary)' }}>{live ? 'Live' : error ? 'Offline' : 'Connecting'}</span>
        {age && <span className="muted text-xs">updated {age}</span>}
      </div>
      {detail && (
        <ul className="mt-2 space-y-1 text-xs secondary tabular">
          {Object.entries(health).map(([name, h]) => (
            <li key={name}>
              {h.subscribed ? '●' : '○'} {name}: {h.lastUpdate ? new Date(h.lastUpdate).toLocaleTimeString() : 'waiting'} · {h.reads} reads
              {h.lastPaintMs != null ? ` · ${h.lastPaintMs} ms to screen` : ''}
              {h.errors ? ` · ⚠ ${h.errors} error${h.errors > 1 ? 's' : ''}` : ''}
            </li>
          ))}
          <li className="muted">
            {s.live}/{s.listeners} listening · {s.reads} reads this session
          </li>
        </ul>
      )}
    </div>
  );
}
