import { useEffect, useState } from 'react';
import { dayKey, msUntilStreakLapse } from './streaks';

// The current local day key, re-evaluated at each local midnight so anything
// left open overnight (the header badge, the streak-warning banner) doesn't
// keep treating yesterday's "secured" as today's.
export function useTodayKey() {
  const [today, setToday] = useState(() => dayKey(new Date()));
  useEffect(() => {
    const id = setTimeout(() => setToday(dayKey(new Date())), msUntilStreakLapse() + 500);
    return () => clearTimeout(id);
  }, [today]);
  return today;
}
