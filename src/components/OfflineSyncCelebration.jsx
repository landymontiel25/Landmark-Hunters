import { useCallback, useEffect, useState } from 'react';
import CheckInBlast from './CheckInBlast';
import { OFFLINE_CHECKIN_SYNCED_EVENT } from '../lib/offlineCheckins';

// An offline check-in that synced and was verified gets the exact
// full-screen celebration a check-in made online gets (owner, 2026-11-25):
// CheckInBlast, same size, "+N pts" when the server paid. Online, the blast
// plays for every check-in that posts and shows points only when it paid
// (check-in points are paid once per account, api/_lib/checkinPayout.js),
// so this plays for every verified sync too. Before, it waited for points
// above 0, and an account already paid never saw it.
// It plays only while the app is in front: a sync that lands in the
// background waits for the app to come back, and one the app was closed on
// is kept on the phone and plays at the next launch. Several play in turn.
// The small "synced" notice still shows (outbox.js); the server sends the
// push and the inbox row when it paid (api/offline-checkin.js).

const KEY = 'lh.offlineCelebrations';
const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const write = (q) => {
  try {
    if (q.length) localStorage.setItem(KEY, JSON.stringify(q.slice(-10)));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: it still plays this session */
  }
};

// Pure: the celebration a synced check-in gets, or null.
export function syncCelebration(d, at = Date.now()) {
  if (!d?.saved || !d.verified || d.sameDay) return null;
  return { key: `${d.landmarkId}-${at}`, name: d.landmarkName || '', points: Math.max(0, Number(d.awarded) || 0) };
}

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

export default function OfflineSyncCelebration() {
  const [queue, setQueue] = useState(read);
  const [inFront, setInFront] = useState(visible);
  useEffect(() => {
    const on = (e) => {
      const c = syncCelebration(e?.detail);
      if (c) setQueue((q) => [...q, c]);
    };
    const vis = () => setInFront(visible());
    window.addEventListener(OFFLINE_CHECKIN_SYNCED_EVENT, on);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener(OFFLINE_CHECKIN_SYNCED_EVENT, on);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
  useEffect(() => write(queue), [queue]);
  const next = useCallback(() => setQueue((q) => q.slice(1)), []);
  const now = queue[0];
  if (!now || !inFront) return null;
  return <CheckInBlast key={now.key} landmarkName={now.name} points={now.points} onDone={next} />;
}
