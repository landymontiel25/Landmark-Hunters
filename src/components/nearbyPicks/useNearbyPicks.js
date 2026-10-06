import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  chainedPick,
  composePicks,
  mergeFavorites,
  nearbyPicksCacheKey,
  nextSeenKeys,
  rankNearbyCandidates,
  ratingsCountOf,
  readNearbyPicksCache,
  rotateFavorites,
  selectReady,
  unseenFirst,
  withReasons,
  writeNearbyPicksCache,
} from '../../lib/nearbyPicks';
import { fetchPickReasons } from '../../lib/pickReasonsApi';
import { makeSetId } from '../../lib/setId';
import { seededRandom } from '../../lib/maprRank/experiments.js';

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
// with no call at all. Nothing is logged here: a pick is logged to
// recommendation_log only once it is on screen (see useShownLogger), and
// `setId` (stable for the built set) is what ties those rows together.
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
  fillNew = false,
  fetchReasons = fetchPickReasons,
  // Mapr Phase 1 (src/lib/maprRank): published models, check-in ids, and
  // the exploration context (createdAtMs, shown, votes). All optional.
  models = null,
  visitedIds = null,
  explore = null,
}) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [result, setResult] = useState(null); // { key, picks }
  const inflight = useRef(null);

  const ratingsCount = ratingsCountOf(myReviews);
  const lat = origin?.lat;
  const lng = origin?.lng;
  const key = uid && origin ? nearbyPicksCacheKey({ uid, ratingsCount, origin, miles, lastCategory, extraCount: extraPlaces?.length || 0, scope: fillNew ? 'test' : '' }) : null;

  const cached = useMemo(() => {
    // refreshToken: re-read after a manual refresh cleared the entry.
    void refreshToken;
    return key ? readNearbyPicksCache(key, now) : null;
  }, [key, now, refreshToken]);

  const { usual, fresh, favorites, exploration, meta } = useMemo(
    () =>
      enabled && lat != null
        ? rankNearbyCandidates({ profile, origin: { lat, lng }, miles, myReviews, checkinCounts, now, overrides, extraPlaces, fillNew, uid, models, visitedIds, explore })
        : { usual: [], fresh: [], favorites: [], exploration: null, meta: null },
    [enabled, profile, lat, lng, miles, myReviews, checkinCounts, now, overrides, extraPlaces, fillNew, uid, models, visitedIds, explore]
  );
  // "Show different places": what was on screen before the last refresh is
  // skipped, so the same top places don't come straight back.
  const [seen, setSeen] = useState([]);
  const [pending, setPending] = useState(false);
  const usualQ = useMemo(() => unseenFirst(usual, seen), [usual, seen]);
  const freshQ = useMemo(() => unseenFirst(fresh, seen), [fresh, seen]);
  const chained = useMemo(() => chainedPick({ usual: usualQ, fresh: freshQ, links, lastCategory }), [usualQ, freshQ, links, lastCategory]);
  const explorationQ = useMemo(
    () => (exploration ? { ...exploration, exploit: unseenFirst(exploration.exploit, seen), explore: unseenFirst(exploration.explore, seen) } : null),
    [exploration, seen]
  );

  const live = enabled && online && !!key;
  const sessionStale =
    result?.key === key && Number.isFinite(now) && Number.isFinite(result.at) && now - result.at > SESSION_SET_MAX_AGE_MS;
  const buildTag = sessionStale ? `${key}@${result.at}` : key;
  const needFresh = live && (sessionStale || (!(cached && !cached.stale) && result?.key !== key));
  const urls = useMemo(
    () =>
      needFresh
        ? [chained?.image, ...usualQ.slice(0, 10).map((p) => p.image), ...freshQ.slice(0, 5).map((p) => p.image), ...(explorationQ?.explore || []).slice(0, 5).map((p) => p.image)]
        : [],
    [needFresh, chained, usualQ, freshQ, explorationQ]
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
    const composed = composePicks({
      usual: usualQ,
      fresh: freshQ,
      chained,
      isReady: (p) => status[p.image] === 'loaded',
      exploration: explorationQ,
      rng: seededRandom(`${buildTag}|${Date.now()}`),
    });
    // Set-level decisions, logged with every shown pick of this set.
    const setTelemetry = meta
      ? {
          variants: meta.variants,
          fallbacks: meta.fallbacks,
          rankLatencyMs: meta.latencyMs,
          epsilon: explorationQ ? explorationQ.epsilon : null,
          epsilonReason: explorationQ ? explorationQ.reason : null,
        }
      : null;
    (composed.length ? Promise.resolve(fetchReasons(composed)).catch(() => ({})) : Promise.resolve({})).then((reasons) => {
      if (!mounted.current || inflight.current !== buildTag) return;
      const setId = makeSetId(uid);
      const picks = withReasons(composed, reasons).map((p, i) => ({
        ...p,
        setId,
        ...(setTelemetry
          ? {
              telemetry: {
                ...(p.telemetry || {}),
                ...setTelemetry,
                rankPosition: i + 1,
                explore: p.slot === 'explore',
                noveltyScore: p.slot === 'explore' ? p.noveltyScore ?? null : null,
              },
            }
          : {}),
      }));
      // An empty set (nothing nearby, or no photo loaded) isn't worth keeping.
      if (picks.length) writeNearbyPicksCache(key, picks);
      setResult({ key, picks, at: Math.max(Date.now(), Number.isFinite(now) ? now : 0) });
      setPending(false);
    });
  }, [needFresh, settled, key, buildTag, now, usualQ, freshQ, chained, status, fetchReasons, uid, explorationQ, meta]);

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
  const rotatedFavorites = useMemo(() => rotateFavorites(favorites, seen), [favorites, seen]);
  const shown = useMemo(() => (enabled && picks ? mergeFavorites(picks, rotatedFavorites) : picks), [enabled, picks, rotatedFavorites]);

  // The refresh button: skip everything on screen now and build another set.
  const shownRef = useRef([]);
  shownRef.current = shown || [];
  const showDifferent = useCallback(() => {
    if (!key) return;
    setSeen((prev) => nextSeenKeys({ seen: prev, shown: shownRef.current }));
    setPending(true);
    refresh();
  }, [key, refresh]);

  // One id for the set on screen. A set saved before setIds existed gets a
  // stable one derived from when it was cached.
  const setId = picks?.find((p) => p.setId)?.setId || (picks?.length && uid ? `${uid}-legacy-${cached?.at ?? 0}` : null);

  return {
    picks: shown,
    setId,
    updating,
    slow,
    usual,
    fresh,
    favorites,
    chained,
    cachedAt: cached?.at ?? null,
    refresh,
    showDifferent,
    refreshing: pending,
    stagnating: !!exploration?.stagnating,
  };
}
