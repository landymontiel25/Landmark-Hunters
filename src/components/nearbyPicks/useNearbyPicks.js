import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  chainedPick,
  composePicks,
  mergeFavorites,
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
// A set built this session is rebuilt once it is this old (checked whenever
// `now` moves: on a timer and when the user comes back to the app).
export const SESSION_SET_MAX_AGE_MS = 30 * 60 * 1000;

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

// A row's items, ready to show, up to `limit`: a place with no photo shows
// on a category tile (PickPhoto), and so does one whose photo failed; one
// still loading waits, up to IMAGE_WAIT_MS, then shows anyway.
export function useReadyItems(items, limit) {
  const candidates = useMemo(() => (items || []).slice(0, limit * 2 + 2), [items, limit]);
  const urls = useMemo(() => candidates.map((p) => p.image), [candidates]);
  const { status, settled } = useImageStatus(urls);
  return selectReady(candidates, (p) => settled || status[p.image] === 'loaded' || status[p.image] === 'failed', limit);
}

// Everything behind "Picked for you right now" on the Map tab, as data:
//   picks    -- the set on screen (null while the very first set loads)
//   updating -- an older cached set is on screen while a new one is built
//   slow     -- offline: the last cached set stays on screen, no new one
//               is attempted until the connection is back
//   usual/fresh -- the ranked queues, for the other cards
//
// A fresh cached set (under 4 hours, same spot/distance/ratings) shows as-is
// with no call at all. Every set that is built is logged to
// recommendation_log as real usage (isTest false) so it counts toward
// Mapr's match rate.
export function useNearbyPicks({
  uid,
  enabled = true,
  online = true,
  profile,
  origin,
  miles,
  myReviews,
  checkinCounts,
  links,
  lastCategory,
  now,
  overrides = null,
  extraPlaces = null,
  isTest = false,
  source = 'map-picks',
  fetchReasons = fetchPickReasons,
  logPicks = logRecommendations,
}) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [result, setResult] = useState(null); // { key, picks }
  const inflight = useRef(null);

  const ratingsCount = ratingsCountOf(myReviews);
  const lat = origin?.lat;
  const lng = origin?.lng;
  const key = uid && origin ? nearbyPicksCacheKey({ uid, ratingsCount, origin, miles, lastCategory, extraCount: extraPlaces?.length || 0 }) : null;

  const cached = useMemo(() => {
    // refreshToken: re-read after a manual refresh cleared the entry.
    void refreshToken;
    return key ? readNearbyPicksCache(key, now) : null;
  }, [key, now, refreshToken]);

  const { usual, fresh, favorites } = useMemo(
    () =>
      enabled && lat != null
        ? rankNearbyCandidates({ profile, origin: { lat, lng }, miles, myReviews, checkinCounts, now, overrides, extraPlaces })
        : { usual: [], fresh: [], favorites: [] },
    [enabled, profile, lat, lng, miles, myReviews, checkinCounts, now, overrides, extraPlaces]
  );
  const chained = useMemo(() => chainedPick({ usual, fresh, links, lastCategory }), [usual, fresh, links, lastCategory]);

  const live = enabled && online && !!key;
  const sessionStale =
    result?.key === key && Number.isFinite(now) && Number.isFinite(result.at) && now - result.at > SESSION_SET_MAX_AGE_MS;
  const buildTag = sessionStale ? `${key}@${result.at}` : key;
  const needFresh = live && (sessionStale || (!(cached && !cached.stale) && result?.key !== key));
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
    if (!needFresh || !settled || inflight.current === buildTag) return;
    inflight.current = buildTag;
    const composed = composePicks({ usual, fresh, chained, isReady: (p) => status[p.image] === 'loaded' });
    (composed.length ? Promise.resolve(fetchReasons(composed)).catch(() => ({})) : Promise.resolve({})).then((reasons) => {
      if (!mounted.current || inflight.current !== buildTag) return;
      const picks = withReasons(composed, reasons);
      // An empty set (nothing nearby, or no photo loaded) isn't worth keeping.
      if (picks.length) writeNearbyPicksCache(key, picks);
      setResult({ key, picks, at: Math.max(Date.now(), Number.isFinite(now) ? now : 0) });
      if (uid && picks.length) {
        Promise.resolve(logPicks({ uid, source, stops: picks, rankedIds: picks.map(pickKey), isTest })).catch(() => {});
      }
    });
  }, [needFresh, settled, key, buildTag, now, usual, fresh, chained, status, fetchReasons, logPicks, uid, source, isTest]);

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
  let slow = false;
  if (enabled) {
    // A new set that came back empty (every photo failed on a bad
    // connection) never replaces a cached set that has cards in it.
    picks = (freshPicks?.length ? freshPicks : null) || cached?.picks || freshPicks || null;
    updating = online && !freshPicks && !!cached?.stale;
    slow = !online;
  }

  // Places you rated highly within a mile go first, built from the live
  // position and ratings rather than the cached set.
  const shown = useMemo(() => (enabled && picks ? mergeFavorites(picks, favorites) : picks), [enabled, picks, favorites]);

  return { picks: shown, updating, slow, usual, fresh, favorites, chained, cachedAt: cached?.at ?? null, refresh };
}
