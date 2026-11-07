import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { readPersisted } from './usePersistentState';
import { getMyLeaderboardEntry } from './leaderboard';
import { subscribeMySoloStreak } from './soloStreaks';
import { displayStreakCount } from './streaks';

// Your streak and this period's points, read-only (the app's Header keeps
// both up to date; it stays mounted behind full screen).
export function useHeaderStats() {
  const { user, firebaseEnabled } = useAuth();
  const uid = user?.uid || null;
  const [streak, setStreak] = useState({ uid: null, value: null });
  const [points, setPoints] = useState({ uid: null, value: null });
  useEffect(() => {
    if (!firebaseEnabled || !uid) return undefined;
    return subscribeMySoloStreak(uid, (s) => setStreak({ uid, value: s }), () => {});
  }, [firebaseEnabled, uid]);
  useEffect(() => {
    if (!firebaseEnabled || !uid) return undefined;
    let live = true;
    const saved = readPersisted('leaderboard.period');
    const period = ['weekly', 'monthly', 'yearly'].includes(saved) ? saved : 'weekly';
    getMyLeaderboardEntry(period, uid)
      .then((mine) => live && setPoints({ uid, value: mine?.points || 0 }))
      .catch(() => live && setPoints({ uid, value: null }));
    return () => {
      live = false;
    };
  }, [firebaseEnabled, uid]);
  return {
    streak: streak.uid === uid ? displayStreakCount(streak.value) : 0,
    points: points.uid === uid ? points.value : null,
  };
}

export function initialsOf(user) {
  const parts = (user?.displayName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length) return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  return (user?.email?.[0] || 'M').toUpperCase();
}

// The name on the top bar's pill: first name, else the email's local part.
export function pillName(user) {
  const first = (user?.displayName || '').trim().split(/\s+/)[0];
  return first || (user?.email ? user.email.split('@')[0] : 'Me');
}
