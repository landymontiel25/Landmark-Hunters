import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useFriends } from './FriendsContext';
import { useBadges } from './BadgesContext';
import { authHeaders } from './apiAuth';
import { subscribeMyStreaks, startStreak, leaveStreak, submitMyEntry, PICKS_STREAK_THRESHOLD } from './pairStreaks';
import { dayKey } from './streaks';

const PairStreakContext = createContext(null);

// Every pair streak you're in (server truth, live), plus the day-close
// sync: the moment your own "3 landmarks today" quota is hit (Mapr Travel
// Picks' votes/ratings via BadgesContext's actionsToday), this submits your
// entry for every active streak and pings the server to check whether the
// PAIR's day is done -- see api/close-streak-day.js for why that decision
// is never made on the client.
export function PairStreakProvider({ children }) {
  const { user } = useAuth();
  const { myUsername } = useFriends();
  const { actionsToday } = useBadges();
  const [streaks, setStreaks] = useState([]);
  // `${pairId}:${dayKey}` already pinged today -- avoids re-firing the
  // network calls on every render once the quota's already been hit; the
  // server side is idempotent regardless, this is just to be polite about it.
  const pingedRef = useRef(new Set());

  useEffect(() => {
    if (!user) {
      setStreaks([]);
      return undefined;
    }
    return subscribeMyStreaks(user.uid, setStreaks, () => {});
  }, [user?.uid]);

  useEffect(() => {
    if (!user || actionsToday < PICKS_STREAK_THRESHOLD || !streaks.length) return;
    const today = dayKey(new Date());
    streaks.forEach((s) => {
      const key = `${s.id}:${today}`;
      if (pingedRef.current.has(key)) return;
      pingedRef.current.add(key);
      (async () => {
        try {
          await submitMyEntry(s.id, user.uid, { done: true, count: actionsToday });
          await fetch('/api/close-streak-day', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
            body: JSON.stringify({ pairId: s.id, dayId: today }),
          });
        } catch {
          pingedRef.current.delete(key);
        }
      })();
    });
  }, [user, actionsToday, streaks]);

  const value = {
    streaks,
    startStreakWith: (friend) => startStreak({ uid: user.uid, name: myUsername }, friend),
    leaveStreak,
  };

  return <PairStreakContext.Provider value={value}>{children}</PairStreakContext.Provider>;
}

export function usePairStreaks() {
  const ctx = useContext(PairStreakContext);
  if (!ctx) throw new Error('usePairStreaks must be used inside PairStreakProvider');
  return ctx;
}
