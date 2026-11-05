import { useEffect, useMemo, useRef, useState } from 'react';
import { loadLandmarkRatings } from './landmarkRatings';

// Outside (Google / Tripadvisor) ratings for a page of the Landmarks list,
// loaded up front instead of row by row as you scroll (owner, 2026-11-05: the
// ratings were still loading in at the bottom of the list). The current page
// loads first, then the NEXT page loads behind it, so by the time you tap
// Next its ratings are already there.
//
// Google's and Tripadvisor's terms forbid caching their ratings, so nothing
// is stored anywhere: the answers live in this hook's memory for this visit,
// only for the current and next page, and are dropped as soon as the pages
// move on. Going back a page asks again.
//
// Requests go out BATCH at a time and the loop stops between batches when the
// page changes, so flipping through pages quickly does not pile up calls for
// pages nobody is looking at. (loadLandmarkRatings also shares a request
// already in flight, so a row that asks for the same place makes no second
// call, and it pauses a minute after a 401/429/503.)
const BATCH = 6;
const NONE = {};

export const ratingKey = (l) => `${l.regionId ?? l.region}/${l.id}`;

// A failed or paused lookup comes back empty; keep nothing for it, so the
// row's own lookup can still try later.
const hasAnswer = (s) => !!s && (!!s.google || !!s.tripadvisor || s.googleNoRating === true);

// current / next: the landmarks on this page and on the next one (items that
// are not places, like a divider, are skipped). Returns { [region/id]: sources }.
export function usePageRatings(current, next, enabled = true) {
  const places = (list) => list.filter((l) => l && l.id && (l.regionId ?? l.region));
  const currentSig = places(current).map(ratingKey).join('|');
  const nextSig = places(next).map(ratingKey).join('|');
  const [data, setData] = useState(NONE);
  const store = useRef(NONE);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const groups = [places(current), places(next)];
    const wanted = new Set(groups.flat().map(ratingKey));
    // Drop the answers of pages we have moved past.
    store.current = Object.fromEntries(Object.entries(store.current).filter(([k]) => wanted.has(k)));
    (async () => {
      for (const group of groups) {
        const todo = group.filter((l) => !store.current[ratingKey(l)]);
        for (let i = 0; i < todo.length; i += BATCH) {
          if (cancelled) return;
          await Promise.all(
            todo.slice(i, i + BATCH).map(async (l) => {
              const sources = await loadLandmarkRatings(l);
              if (cancelled || !hasAnswer(sources)) return;
              store.current = { ...store.current, [ratingKey(l)]: sources };
              setData(store.current);
            })
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // The page contents are captured by the signatures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, currentSig, nextSig]);

  // Only what this page and the next one need, even if an answer for a page
  // we left is still in `data`.
  return useMemo(() => {
    if (!enabled) return NONE;
    const keys = new Set([...currentSig.split('|'), ...nextSig.split('|')]);
    return Object.fromEntries(Object.entries(data).filter(([k]) => keys.has(k)));
  }, [enabled, data, currentSig, nextSig]);
}
