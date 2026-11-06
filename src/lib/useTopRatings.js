import { useEffect, useMemo, useRef, useState } from 'react';
import { loadLandmarkRatings } from './landmarkRatings';

// Top Landmarks (owner, 2026-11-06) ranks by Google's stars and review count
// (topRated.js topLandmarksOrder), so it needs Google's answer for each place
// before it can show the list. Google's terms forbid keeping ratings, so they
// live in this screen's state only, for this visit, and the rows reuse them
// (no second call per place).
//
// At most TOP_RANK_MAX places are looked up (the ratings endpoint allows a
// user 300 lookups in 10 minutes). A longer list (All Cities, or a city with
// hundreds of imported places) looks up its hand-picked places first, then
// imported ones, up to the cap; the rest follow unranked.
export const TOP_RANK_MAX = 120;
// Nothing shows until the answers are in or this long has passed, so the
// order is fixed once and never reshuffles under your thumb.
export const TOP_WAIT_MS = 6000;

const isImported = (l) => l?.source === 'osm' || String(l?.id || '').startsWith('osm-');

export function topCandidates(list, max = TOP_RANK_MAX) {
  const places = list.filter((l) => l && l.id && (l.regionId || l.region));
  if (places.length <= max) return places;
  return [...places.filter((l) => !isImported(l)), ...places.filter(isImported)].slice(0, max);
}

// Returns { google, ready }: google is { [landmarkId]: sources } frozen at the
// moment it became ready; ready is true once every candidate answered (or
// TOP_WAIT_MS passed), or straight away when disabled.
export function useTopRatings(list, enabled) {
  const cands = useMemo(() => (enabled ? topCandidates(list) : []), [list, enabled]);
  const sig = cands.map((l) => `${l.regionId || l.region}/${l.id}`).join('|');
  const [answers, setAnswers] = useState({});
  const [timedOut, setTimedOut] = useState(null);
  const asked = useRef(new Set());

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    for (const l of cands) {
      if (asked.current.has(l.id)) continue;
      asked.current.add(l.id);
      loadLandmarkRatings(l).then((sources) => {
        if (!cancelled) setAnswers((cur) => ({ ...cur, [l.id]: sources }));
      });
    }
    const t = setTimeout(() => !cancelled && setTimedOut(sig), TOP_WAIT_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
      // An unmounted screen's requests still settle; asking again next time
      // is right (nothing is kept).
    };
    // cands is captured by sig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sig]);

  const answered = cands.every((l) => answers[l.id] !== undefined);
  const ready = !enabled || answered || timedOut === sig;
  // Freeze the order's data once ready for this list.
  const snap = useRef({ sig: null, google: {} });
  if (enabled && ready && snap.current.sig !== sig) snap.current = { sig, google: answers };
  return { google: enabled ? snap.current.google : {}, live: answers, ready };
}
