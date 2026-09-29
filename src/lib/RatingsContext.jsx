import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getAllRatings, getUserReviews } from './reviews';
import { firebaseEnabled } from './firebase';
import { useAuth } from './AuthContext';

// Loads every landmark's aggregate user rating once and shares it, so cards,
// the Top Rated sort, and detail pages all read from one place. Also holds
// the signed-in user's own reviews keyed by landmarkId, so anything showing
// a "Rated" state (the Rate pill, the landmark page) can check without a
// read per landmark. Both refresh together via reload() after a save.
const RatingsContext = createContext(null);

// The very first read of a session can lose a race with Firebase Auth/
// Firestore still wiring up right after sign-in/app launch -- one
// transient failure there used to mean myReviews just stayed empty until
// something ELSE happened to call reload() again, which made anything
// built on it (the Taste Profile Score, most visibly) look like it hadn't
// loaded at all until some unrelated interaction triggered a fresh fetch.
// A couple of quick retries covers that startup race on its own.
const FETCH_RETRIES = 2;
async function withRetry(fn) {
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === FETCH_RETRIES) throw e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return undefined;
}

export function RatingsProvider({ children }) {
  const { user } = useAuth();
  const [ratings, setRatings] = useState({});
  const [myReviews, setMyReviews] = useState({});
  // Whose reviews myReviews holds once the first read for them finished
  // (or failed), so a screen can tell "no ratings yet" from "not loaded".
  const [loadedFor, setLoadedFor] = useState(null);

  const reload = useCallback(async () => {
    if (!firebaseEnabled) return;
    try {
      setRatings(await withRetry(getAllRatings));
    } catch {
      /* offline / rules — leave ratings empty */
    }
    if (!user) {
      setMyReviews({});
      return;
    }
    try {
      const list = await withRetry(() => getUserReviews(user.uid));
      setMyReviews(Object.fromEntries(list.map((r) => [r.landmarkId, r])));
    } catch {
      /* leave whatever we had */
    }
    setLoadedFor(user.uid);
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  const myReviewsLoaded = !!user && loadedFor === user.uid;
  return <RatingsContext.Provider value={{ ratings, myReviews, myReviewsLoaded, reload }}>{children}</RatingsContext.Provider>;
}

export function useRatings() {
  const ctx = useContext(RatingsContext);
  if (!ctx) throw new Error('useRatings must be used inside RatingsProvider');
  return ctx;
}
