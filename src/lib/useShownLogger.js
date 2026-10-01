import { useCallback, useEffect, useRef } from 'react';
import { logShownPicks } from './recommendationLog';

// Returns logShown(setId, stops, overrides?) -- logs stops that are on
// screen, once per set per place (deduped in logShownPicks). Reads the
// profile through a ref so the prediction uses the latest scores without
// changing the callback's identity.
export function useShownLogger({ uid, profile, surface, source, isTest = false, pickType, rankedIds, log = logShownPicks }) {
  const ref = useRef({});
  ref.current = { uid, profile, surface, source, isTest, pickType, rankedIds, log };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return useCallback((setId, stops, overrides = {}) => {
    const { uid: u, profile: pr, surface: sf, source: src, isTest: t, pickType: pt, rankedIds: ri, log: lg } = ref.current;
    if (!u || !setId || !stops?.length) return;
    // Hold nothing the UI can read: prediction is computed inside the log call.
    Promise.resolve(lg({ uid: u, setId, stops, profile: pr, surface: sf, source: src, isTest: t, pickType: pt, rankedIds: ri, ...overrides })).catch(() => {});
  }, []);
}

