import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { useFriends } from './FriendsContext';
import { subscribeMyStreaks, startStreak, leaveStreak, closeToday } from './pairStreaks';

const PairStreakContext = createContext(null);

// Every pair streak you're in, live from the server. The actual daily
// completion trigger (rating + guessing all 3 of today's shared cards)
// lives in MyStreaks.jsx, which calls closeToday() itself right after the
// last guess lands -- there's nothing to watch passively here anymore now
// that a day means something specific (the shared deck), not just "voted
// on 3 things somewhere in the app".
export function PairStreakProvider({ children }) {
  const { user } = useAuth();
  const { myUsername } = useFriends();
  const [streaks, setStreaks] = useState([]);

  useEffect(() => {
    if (!user) {
      setStreaks([]);
      return undefined;
    }
    return subscribeMyStreaks(user.uid, setStreaks, () => {});
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = {
    streaks,
    startStreakWith: (friend) => startStreak({ uid: user.uid, name: myUsername }, friend),
    leaveStreak,
    closeToday,
  };

  return <PairStreakContext.Provider value={value}>{children}</PairStreakContext.Provider>;
}

export function usePairStreaks() {
  const ctx = useContext(PairStreakContext);
  if (!ctx) throw new Error('usePairStreaks must be used inside PairStreakProvider');
  return ctx;
}
