import { useEffect, useMemo, useRef, useState } from 'react';
import { loadLandmarkRatings, LOOKUP_DELAY_MS } from './landmarkRatings';

// Top Landmarks (owner, 2026-11-06) ranks by Google's stars and review count
// (topRated.js topLandmarksOrder), and the Map sheet's Highest rated sort by
// Google's weighted stars. Google's terms forbid storing ratings, so they
// live in memory only (this module, for as long as the app stays open;
// never localStorage or Firestore), and the rows reuse them (no second call
// per place). Keeping them for the session makes a second visit to the
// Landmarks tab instant and saves the per-account lookup limit.
//
// The list shows right away (owner, 2026-11-08: "it needs to happen right
// when users open the landmarks tab") in its fallback order, then takes the
// Google order once, when every answer is in or TOP_WAIT_MS has passed.
//
// The top 50 of the sort's order are sorted by review count, in each category
// you pick (a category filters the list first; owner, 2026-11-11).
export const TOP_RANK_MAX = 50;
// Nothing shows until the answers are in or this long has passed, so the
// order is fixed once and never reshuffles under your thumb.
export const TOP_WAIT_MS = 6000;

// landmarkId -> sources, for this app session (memory only, see above).
const sessionAnswers = new Map();
const fromSession = (cands) => {
  const out = {};
  for (const l of cands) if (sessionAnswers.has(l.id)) out[l.id] = sessionAnswers.get(l.id);
  return out;
};
// Tests only.
export function _resetTopRatings() {
  sessionAnswers.clear();
  prefetching.clear();
}

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
  const [answers, setAnswers] = useState(() => fromSession(cands));
  const [timedOut, setTimedOut] = useState(null);
  const asked = useRef(new Set());

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const known = fromSession(cands);
    if (Object.keys(known).length) setAnswers((cur) => ({ ...known, ...cur }));
    // Looks up nothing until the list has stayed put for LOOKUP_DELAY_MS
    // (owner, 2026-11-10): a quick change of sort, city or mood costs no calls.
    const start = setTimeout(() => {
      for (const l of cands) {
        if (asked.current.has(l.id) || sessionAnswers.has(l.id)) continue;
        asked.current.add(l.id);
        loadLandmarkRatings(l).then((sources) => {
          // A failed lookup (no Google answer at all) is asked again next time.
          if (sources?.google || sources?.googleNoRating) sessionAnswers.set(l.id, sources);
          if (!cancelled) setAnswers((cur) => ({ ...cur, [l.id]: sources }));
        });
      }
    }, LOOKUP_DELAY_MS);
    const t = setTimeout(() => !cancelled && setTimedOut(sig), TOP_WAIT_MS);
    return () => {
      cancelled = true;
      clearTimeout(start);
      clearTimeout(t);
      // An unmounted screen's requests still settle; asking again next time
      // is right (nothing is kept).
    };
    // cands is captured by sig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sig]);

  const answered = cands.every((l) => answers[l.id] !== undefined || sessionAnswers.has(l.id));
  const ready = !enabled || answered || timedOut === sig;
  // Freeze the order's data once ready for this list.
  const snap = useRef({ sig: null, google: {} });
  // Session answers a fresh list already has count too (they reach `answers`
  // only after the effect runs).
  if (enabled && ready && snap.current.sig !== sig) snap.current = { sig, google: { ...fromSession(cands), ...answers } };
  return { google: enabled ? snap.current.google : {}, live: enabled ? { ...fromSession(cands), ...answers } : answers, ready };
}

// Looks up Google's ratings for a list ahead of time (the Map tab does this
// for the city the Landmarks tab will open on), so tapping Popular there
// sorts at once. Answers land in this module's session memory only.
// Resolves when every lookup settled.
export function prefetchTopRatings(list, max = TOP_RANK_MAX) {
  const jobs = [];
  for (const l of topCandidates(list, max)) {
    if (sessionAnswers.has(l.id) || prefetching.has(l.id)) continue;
    prefetching.add(l.id);
    jobs.push(
      loadLandmarkRatings(l).then((sources) => {
        prefetching.delete(l.id);
        if (sources?.google || sources?.googleNoRating) sessionAnswers.set(l.id, sources);
      })
    );
  }
  return Promise.all(jobs);
}
const prefetching = new Set();
