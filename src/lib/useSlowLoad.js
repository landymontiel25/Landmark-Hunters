import { useEffect, useState } from 'react';

// True once `waiting` has stayed true for `ms`. Screens that sit on a
// skeleton until some read lands use it to swap the skeleton for a "couldn't
// load, try again" card instead of animating forever when that read failed
// (blocked by rules, a missing document, a dead connection).
export function useSlowLoad(waiting, ms = 10000) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setSlow(false);
      return undefined;
    }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [waiting, ms]);
  return waiting && slow;
}
