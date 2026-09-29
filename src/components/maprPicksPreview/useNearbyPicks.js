import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  chainedPick,
  composePicks,
  nearbyPicksCacheKey,
  pickKey,
  rankNearbyCandidates,
  ratingsCountOf,
  readNearbyPicksCache,
  selectReady,
  withReasons,
  writeNearbyPicksCache,
} from '../../lib/nearbyPicks';
import { fetchPickReasons } from '../../lib/pickReasonsApi';
import { logRecommendations } from '../../lib/recommendationLog';

// How long to wait for candidate photos before composing with whatever has
// loaded. A card whose photo is still loading after this is skipped.
export const IMAGE_WAIT_MS = 3000;

// Preloads photos and reports each one as 'loading' | 'loaded' | 'failed'.
// settled: every photo answered, or the wait ran out.
export function useImageStatus(urls, { enabled = true, timeoutMs = IMAGE_WAIT_MS } = {}) {
  const [status, setStatus] = useState({});
  const [expiredFor, setExpiredFor] = useState(null);
  const list = useMemo(() => [...new Set((urls || []).filter(Boolean))], [urls]);
  const sig = list.join('|');

  useEffect(() => {
    if (!enabled || !list.length || typeof Image === 'undefined') return undefined;
    let cancelled = false;
    const imgs = list.map((url) => {
      const img = new Image();
      img.onload = () => !cancelled && setStatus((s) => (s[url] === 'loaded' ? s : { ...s, [url]: 'loaded' }));
      img.onerror = () => !cancelled && setStatus((s) => (s[url] === 'failed' ? s : { ...s, [url]: 'failed' }));
      img.src = url;
      return img;
    });
    const timer = setTimeout(() => !cancelled && setExpiredFor(sig), timeoutMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const img of imgs) img.onload = img.onerror = null;
    };
  }, [list, sig, enabled, timeoutMs]);

  const settled = expiredFor === sig || list.every((u) => status[u] === 'loaded' || status[u] === 'failed');
  return { status, settled };
}

// A row's items with the skip rule applied: only ones whose photo has
// loaded, in order, up to `limit` -- a loading or broken one is skipped and
// the next takes its place.
export function useReadyItems(items, limit) {
  const candidates = useMemo(() => selectReady(items).slice(0, limit * 2 + 2), [items, limit]);
  const urls = useMemo(() => candidates.map((p) => p.image), [candidates]);
  const { status } = useImageStatus(urls);
  return selectReady(candidates, (p) => status[p.image] === 'loaded', limit);
}

// Everything behind "Picked for you right now", as data:
//   picks    -- the set on screen (null while the very first set loads)
//   updating -- an older set is on screen while a new one is built
//   usual/fresh -- the ranked queues, for the other cards
//
// mode (Test tab "Preview as" override):
//   'returning' -- real behavior: a fresh cached set shows as-is; an old one
//                  shows with "Updating..." until the new set replaces it
//   'old-cache' -- hold the cached set and stay in "Updating..."
//   'slow'      -- no network: keep the cached set on screen
export function useNearbyPicks({
  uid,
  enabled = true,
  mode = 'returning',
  profile,
  origin,
  miles,
  myReviews,
  checkinCounts,
  links,
  lastCategory,
  now,
  isTest = true,
  source = 'mapr-picks-preview',
  fetchReasons = fetchPickReasons,
  logPicks = logRecommendations,
}) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [result, setResult] = useState(null); // { key, picks }
  const inflight = useRef(null);

  const ratingsCount = ratingsCountOf(myReviews);
  const lat = origin?.lat;
  const lng = origin?.lng;
  const key = uid && origin ? nearbyPicksCacheKey({ uid, ratingsCount, origin, miles, lastCategory }) : null;

  const cached = useMemo(() => {
    // refreshToken: re-read after a manual refresh cleared the entry.
    void refreshToken;
    return key ? readNearbyPicksCache(key, now) : null;
  }, [key, now, refreshToken]);

  const { usual, fresh } = useMemo(
    () =>
      enabled && lat != null
        ? rankNearbyCandidates({ profile, origin: { lat, lng }, miles, myReviews, checkinCounts, now })
        : { usual: [], fresh: [] },
    [enabled, profile, lat, lng, miles, myReviews, checkinCounts, now]
  );
  const chained = useMemo(() => chainedPick({ usual, fresh, links, lastCategory }), [usual, fresh, links, lastCategory]);

  const live = enabled && mode === 'returning' && !!key;
  const needFresh = live && !(cached && !cached.stale) && result?.key !== key;
  const urls = useMemo(
    () => (needFresh ? [chained?.image, ...usual.slice(0, 10).map((p) => p.image), ...fresh.slice(0, 5).map((p) => p.image)] : []),
    [needFresh, chained, usual, fresh]
  );
  const { status, settled } = useImageStatus(urls, { enabled: needFresh });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // One composition and one reasons call per key: a photo that finishes
  // loading after the wait doesn't reshuffle the set or trigger a second call.
  useEffect(() => {
    if (!needFresh || !settled || inflight.current === key) return;
    inflight.current = key;
    const composed = composePicks({ usual, fresh, chained, isReady: (p) => status[p.image] === 'loaded' });
    (composed.length ? Promise.resolve(fetchReasons(composed)).catch(() => ({})) : Promise.resolve({})).then((reasons) => {
      if (!mounted.current || inflight.current !== key) return;
      const picks = withReasons(composed, reasons);
      // An empty set (nothing nearby, or no photo loaded) isn't worth keeping.
      if (picks.length) writeNearbyPicksCache(key, picks);
      setResult({ key, picks });
      if (uid && picks.length) {
        Promise.resolve(logPicks({ uid, source, stops: picks, rankedIds: picks.map(pickKey), isTest })).catch(() => {});
      }
    });
  }, [needFresh, settled, key, usual, fresh, chained, status, fetchReasons, logPicks, uid, source, isTest]);

  // Nothing cached to demo "old cache" / "slow signal" with: stand in the
  // set the ranking would give, with plain reasons, as that cached set.
  const standIn = useMemo(
    () => (enabled && !live ? withReasons(composePicks({ usual, fresh, chained }), {}) : null),
    [enabled, live, usual, fresh, chained]
  );

  const refresh = useCallback(() => {
    if (key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* private mode */
      }
    }
    inflight.current = null;
    setResult(null);
    setRefreshToken((n) => n + 1);
  }, [key]);

  const freshPicks = result?.key === key ? result.picks : null;
  let picks = null;
  let updating = false;
  if (enabled) {
    if (mode === 'old-cache') {
      picks = cached?.picks || standIn;
      updating = true;
    } else if (mode === 'slow') {
      picks = cached?.picks || standIn;
    } else {
      picks = freshPicks || cached?.picks || null;
      updating = !freshPicks && !!cached?.stale;
    }
  }

  return { picks, updating, usual, fresh, chained, cachedAt: cached?.at ?? null, refresh };
}
