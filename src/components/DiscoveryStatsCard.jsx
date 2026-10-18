import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { getTodaysTimeSavedMinutes } from '../lib/timeSaved';

// The headline stat card: time saved leads, points/leaderboard follow
// further down and smaller. A real, tracked figure, not copy -- summed
// from actually-logged Mapr chat replies that produced stops
// (timeSaved.js), each one comparing its own real generation time against
// a stated manual-planning baseline, never a guess made up per session.
// Off for now (owner, 2026-10-18: "toggle it off, we'll add it back later").
// Set to true to show the card again on Profile and Mapr.
export const SHOW_TIME_SAVED_CARD = false;

export default function DiscoveryStatsCard({ enabled = SHOW_TIME_SAVED_CARD }) {
  const { user, firebaseEnabled } = useAuth();
  const [minutesSaved, setMinutesSaved] = useState(null);

  useEffect(() => {
    if (!enabled || !firebaseEnabled || !user) {
      setMinutesSaved(null);
      return;
    }
    let cancelled = false;
    // The card only appears once there's a figure to show (0 hides it), so
    // there's no skeleton here -- one would flash and vanish for most
    // people. A failed read just leaves it hidden, same as "nothing yet".
    getTodaysTimeSavedMinutes(user.uid)
      .then((minutes) => {
        if (!cancelled) setMinutesSaved(minutes);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, user, firebaseEnabled]);

  if (!enabled || !user || !minutesSaved) return null;

  return (
    <div className="card section discovery-stats-card">
      <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{minutesSaved}</div>
      <div className="screen-subtitle" style={{ margin: 0 }}>minutes saved planning today</div>
    </div>
  );
}
