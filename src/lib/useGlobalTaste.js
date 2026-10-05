import { useEffect, useRef } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext';
import { useFriends } from './FriendsContext';
import { useRatings } from './RatingsContext';
import { getPickFeedback } from './pickFeedback';
import { commentTagDeltas } from './commentSignals';
import { GLOBAL_TASTE, GLOBAL_TASTE_VERSION, hasGlobalTaste, rebuildGlobalTaste } from './tagScores';

// One-time move to one overall taste (tagScores.GLOBAL_TASTE): an account
// without it gets it rebuilt from every rating, vote and sign-up swipe it
// has, in any city. A new account gets an empty one, which still marks it
// as moved, so from then on every rating writes there as it happens.
export async function migrateToGlobalTaste(uid, { reviews, profile, nowMs = Date.now() }) {
  if (!db || !uid) return null;
  const votes = Object.values((await getPickFeedback(uid)) || {});
  const m = rebuildGlobalTaste({
    reviews,
    votes,
    seedDeltas: profile?.onboardingSwipeDeltas || {},
    commentDeltas: commentTagDeltas,
    nowMs,
  });
  await updateDoc(doc(db, 'users', uid), {
    [`tagScores.${GLOBAL_TASTE}`]: m.scores,
    [`tagScoresAt.${GLOBAL_TASTE}`]: m.at,
    [`tagCounts.${GLOBAL_TASTE}`]: m.counts,
    globalTasteVersion: GLOBAL_TASTE_VERSION,
  });
  return m;
}

// Runs the move once per signed-in account, after a real server read of the
// profile and the account's own reviews (so it never rebuilds from a cache).
export function useGlobalTaste() {
  const { user } = useAuth();
  const { myProfile, profileFresh } = useFriends();
  const { myReviews, myReviewsLoaded } = useRatings();
  const tried = useRef(null);
  const uid = user?.uid || null;
  const ready = !!uid && profileFresh && myReviewsLoaded && !!myProfile && !hasGlobalTaste(myProfile);
  useEffect(() => {
    if (!ready || tried.current === uid) return;
    tried.current = uid;
    migrateToGlobalTaste(uid, { reviews: Object.values(myReviews || {}), profile: myProfile }).catch((err) => {
      console.error('[useGlobalTaste] move to one taste failed:', err);
      tried.current = null;
    });
  }, [ready, uid, myReviews, myProfile]);
}

export default function GlobalTasteSync() {
  useGlobalTaste();
  return null;
}
