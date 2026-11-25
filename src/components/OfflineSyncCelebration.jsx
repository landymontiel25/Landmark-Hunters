import { useCallback, useEffect, useState } from 'react';
import CheckInBlast from './CheckInBlast';
import { OFFLINE_CHECKIN_SYNCED_EVENT } from '../lib/offlineCheckins';

// An offline check-in that synced and paid gets the same full-screen
// celebration as a check-in made online (owner, 2026-11-25): CheckInBlast,
// same size, same points. It plays wherever they are in the app when the
// phone gets signal back; several syncing at once play one after another.
// The small "synced" notice still shows too (outbox.js), and the server sends
// the push and the inbox row (api/offline-checkin.js).
export default function OfflineSyncCelebration() {
  const [queue, setQueue] = useState([]);
  useEffect(() => {
    const on = (e) => {
      const d = e?.detail;
      if (!d?.saved || !d.verified || !(d.awarded > 0)) return;
      setQueue((q) => [...q, { key: `${d.landmarkId}-${Date.now()}`, name: d.landmarkName || '', points: d.awarded }]);
    };
    window.addEventListener(OFFLINE_CHECKIN_SYNCED_EVENT, on);
    return () => window.removeEventListener(OFFLINE_CHECKIN_SYNCED_EVENT, on);
  }, []);
  const next = useCallback(() => setQueue((q) => q.slice(1)), []);
  const now = queue[0];
  if (!now) return null;
  return <CheckInBlast key={now.key} landmarkName={now.name} points={now.points} onDone={next} />;
}
