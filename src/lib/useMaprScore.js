import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { useFriends } from './FriendsContext';
import { useRatings } from './RatingsContext';
import { estimateTasteScore, onboardingRatingTest } from './tasteEstimate';
import { loadTasteSummary, TASTE_ANSWER_EVENT } from './tasteScoreStore';

// The Mapr Score, as the Taste Profile card shows it: the live taste score
// (how often Mapr's hidden guess matched your answer) once it's ready, and
// until then a display-only estimate from the reviews already loaded.
// Shared by the Taste Profile card and Mapr's home orb so both always show
// the same number.
//   { learning, score, estimated, pct } -- pct is what to show (null: none yet)
export function useMaprScore() {
  const { user } = useAuth();
  const { myProfile } = useFriends();
  const { myReviews } = useRatings();
  // null until the first read lands; recomputed when an answer is saved.
  const [taste, setTaste] = useState(null);
  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    const load = () =>
      loadTasteSummary(user.uid)
        .then((t) => live && t && setTaste(t))
        .catch(() => {});
    load();
    const onAnswer = (e) => (e.detail ? live && setTaste(e.detail) : load());
    window.addEventListener(TASTE_ANSWER_EVENT, onAnswer);
    return () => {
      live = false;
      window.removeEventListener(TASTE_ANSWER_EVENT, onAnswer);
    };
  }, [user]);
  // Sign-up onboarding ratings teach the estimate but are never guessed on.
  const estimate = useMemo(() => estimateTasteScore(myReviews, { isOnboarding: onboardingRatingTest(myProfile) }), [myReviews, myProfile]);
  const learning = !taste || taste.state !== 'ready';
  const score = learning ? null : taste.score;
  const estimated = learning && estimate ? estimate.score : null;
  return { learning, score, estimated, pct: learning ? estimated : score };
}
