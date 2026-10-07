import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getAllRatings, getUserReviews } from './reviews';
import { firebaseEnabled } from './firebase';
import { useAuth } from './AuthContext';
import { CheckInContext } from './CheckInContext';
import { withVisited } from './ratingFlow';

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
  const [rawReviews, setMyReviews] = useState({});
  // Rating a place needs no check-in, so a review is not proof of a visit.
  // Each of your reviews is stamped `visited` from your real check-ins
  // (claimedMap -- ratingOnly claims are not in it), and everything that
  // means "places you've been" reads that instead of "has a review".
  const checkInCtx = useContext(CheckInContext);
  const claimedMap = checkInCtx?.claimedMap;
  const claimedLoaded = checkInCtx ? !!checkInCtx.claimedLoaded : true;
  const myReviews = useMemo(
    () => (claimedLoaded ? withVisited(rawReviews, claimedMap) : rawReviews),
    [rawReviews, claimedMap, claimedLoaded]
  );
  // Whose reviews myReviews holds once the first read for them finished
  // (or failed), so a screen can tell "no ratings yet" from "not loaded".
  const [loadedFor, setLoadedFor] = useState(null);

  // Each reload() takes a ticket; only the newest one may write state, so a
  // slow read for account A can't land after sign-out or a switch to B.
  const reqRef = useRef(0);
  // Whose reviews rawReviews currently holds (set together with them).
  const reviewsUidRef = useRef(null);

  const reload = useCallback(async () => {
    if (!firebaseEnabled) return;
    const req = ++reqRef.current;
    const stale = () => req !== reqRef.current;
    try {
      const all = await withRetry(getAllRatings);
      if (!stale()) setRatings(all);
    } catch {
      /* offline / rules — leave ratings empty */
    }
    if (stale()) return;
    if (!user) {
      reviewsUidRef.current = null;
      setMyReviews({});
      return;
    }
    try {
      const list = await withRetry(() => getUserReviews(user.uid));
      if (stale()) return;
      reviewsUidRef.current = user.uid;
      setMyReviews(Object.fromEntries(list.map((r) => [r.landmarkId, r])));
    } catch {
      if (stale()) return;
      // Leave whatever we had -- but only if it was this account's.
      if (reviewsUidRef.current !== user.uid) {
        reviewsUidRef.current = user.uid;
        setMyReviews({});
      }
    }
    setLoadedFor(user.uid);
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  const myReviewsLoaded = !!user && loadedFor === user.uid && claimedLoaded;
  return <RatingsContext.Provider value={{ ratings, myReviews, myReviewsLoaded, reload }}>{children}</RatingsContext.Provider>;
}

export function useRatings() {
  const ctx = useContext(RatingsContext);
  if (!ctx) throw new Error('useRatings must be used inside RatingsProvider');
  return ctx;
}
