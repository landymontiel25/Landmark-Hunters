import { useEffect, useState } from 'react';
import { dayKey, msUntilStreakLapse } from './streaks';

// The current local day key, re-evaluated at each local midnight so anything
// left open overnight (the header badge, the streak-warning banner) doesn't
// keep treating yesterday's "secured" as today's. A phone that slept through
// midnight may never run (or may run early) the one-shot timer, so the key
// is also re-read whenever the page becomes visible again and the timer is
// re-armed after every tick, not only after a change.
export function useTodayKey() {
  const [today, setToday] = useState(() => dayKey(new Date()));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => {
      setToday(dayKey(new Date()));
      setTick((t) => t + 1);
    }, msUntilStreakLapse() + 500);
    return () => clearTimeout(id);
  }, [today, tick]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setToday(dayKey(new Date()));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return today;
}
