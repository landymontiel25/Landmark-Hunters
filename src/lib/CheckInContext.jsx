import { createContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useFriends } from './FriendsContext';
import {
  claimCheckIn,
  getUserCheckedInLandmarkIds,
  subscribeLeaderboard,
  shouldPromptLoveReason,
  POINTS_PER_CHECKIN,
} from './leaderboard';
import { checkinBlockReason, checkinLocationFields, BLOCK_MESSAGES } from './checkinRules';

// Shared check-in state so there's ONE source of truth and a single place to
// trigger the "rate + post" prompt, no matter which screen you checked in
// from (map pin, itinerary, landmark list, or detail page).
export const CheckInContext = createContext(null);

export function CheckInProvider({ children }) {
  const { user, firebaseEnabled } = useAuth();
  const { myUsername, myProfile } = useFriends();
  const [claimedMap, setClaimedMap] = useState({});
  // True once the first read of this account's real check-ins has finished
  // (or failed). RatingsContext waits for it before stamping which rated
  // places were really visited, so a half-loaded map never reads as
  // "rated but never been".
  const [claimedLoaded, setClaimedLoaded] = useState(false);
  const [checkingIn, setCheckingIn] = useState(null);
  // The landmark currently in the rate + post prompt. Tapping "Check In" sets
  // this immediately, but nothing is claimed/awarded yet — that only happens
  // once the user taps Post (see commitCheckIn below).
  const [justCheckedIn, setJustCheckedIn] = useState(null);
  // Per-call flags for the rate + post prompt that follows -- e.g. Rate a
  // Landmark (search-first, no physical visit) requires a comment; a normal
  // Check In tap doesn't. Reset alongside justCheckedIn so a stale flag
  // never leaks into the next check-in.
  const [checkInOptions, setCheckInOptions] = useState({});
  // The "+100! You passed Eduardo — now #1 👑" payoff shown after posting.
  const [celebration, setCelebration] = useState(null);
  // Set right after a real (non-ratingOnly) check-in lands on visit 3, 13,
  // 23, ... -- see shouldPromptLoveReason. The landmark + visit number is
  // all LoveReasonPrompt needs; it looks up any earlier answer itself.
  const [loveReasonPrompt, setLoveReasonPrompt] = useState(null);

  // Keep this week's standings warm so we can detect an overtake the instant a
  // check-in lands (compare where you were vs where +100 puts you).
  const boardRef = useRef([]);
  useEffect(() => {
    if (!user || !firebaseEnabled) {
      boardRef.current = [];
      return;
    }
    const unsub = subscribeLeaderboard('weekly', (entries) => {
      boardRef.current = entries;
    });
    return unsub;
  }, [user, firebaseEnabled]);

  // Whose check-ins claimedMap holds. A different account starts from an
  // empty map, so the last account's "checked in" marks never show (or stay,
  // if this account's read fails) for the next one.
  const claimedUidRef = useRef(null);
  useEffect(() => {
    setClaimedLoaded(false);
    if (!user || !firebaseEnabled) {
      claimedUidRef.current = null;
      setClaimedMap({});
      return;
    }
    if (claimedUidRef.current !== user.uid) {
      claimedUidRef.current = user.uid;
      setClaimedMap({});
    }
    let cancelled = false;
    getUserCheckedInLandmarkIds(user.uid).then((ids) => {
      // Merge rather than replace: a check-in posted while this read was in
      // flight is already marked and may not be in `ids` yet.
      if (!cancelled) setClaimedMap((m) => ({ ...Object.fromEntries(ids.map((id) => [id, true])), ...m }));
    }).catch(() => {}).finally(() => {
      if (!cancelled) setClaimedLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [user, firebaseEnabled]);

  // Compare the week's board before vs after this +points check-in and build a
  // celebratory line if the user climbed past anyone.
  const buildCelebration = (points) => {
    const entries = boardRef.current || [];
    const others = entries.filter((e) => e.userId !== user.uid);
    const mine = entries.find((e) => e.userId === user.uid);
    const before = mine ? mine.points : 0;
    const after = before + points;
    const oldRank = 1 + others.filter((e) => e.points > before).length;
    const newRank = 1 + others.filter((e) => e.points > after).length;
    const improved = newRank < oldRank;
    const overtaken = improved
      ? others.filter((e) => e.points >= before && e.points < after).sort((a, b) => b.points - a.points)
      : [];
    const passed = overtaken[0] || null;

    let message = null;
    if (improved && newRank === 1) {
      message = passed ? `You passed ${passed.userName} — you're #1 now! 👑` : `You're #1 now! 👑`;
    } else if (passed) {
      message = `You passed ${passed.userName} — now #${newRank}! 🔥`;
    }
    return { points, rank: newRank, message };
  };

  // Opens the rate + post prompt for this landmark. No Firestore write here.
  const checkIn = (landmark, options = {}) => {
    if (!user) return;
    setJustCheckedIn(landmark);
    setCheckInOptions(options);
  };

  // The actual check-in: called from the Post button, this is the moment
  // points are awarded and the landmark is marked claimed. ratingOnly (set
  // by Profile's "Rate a Landmark" search) still claims the check-in --
  // unlocking the review, and (see src/lib/streaks.js) feeding the daily
  // votes/ratings tally toward the streak -- but for 0 points: that flow is
  // rating something, not claiming you physically visited it, and shouldn't
  // pay out or secure the day's streak the way a real check-in does on its
  // own. Every other check-in path in the app (map pin, itinerary, landmark
  // list, detail page) never sets this flag, so they keep awarding points
  // and instantly securing the streak exactly as before.
  // `fix` is the user's GPS fix ({ lat, lng, accuracy }) at the moment of
  // Post. This provider sits above GeoProvider, so the caller passes it in.
  // Every real check-in saves distance, accuracy and a verification tag;
  // with REQUIRE_GPS_CHECKIN on, one that fails the rule is refused.
  const commitCheckIn = async (fix = null) => {
    const landmark = justCheckedIn;
    if (!user || !landmark) return null;
    const blocked = checkinBlockReason(fix, landmark, { ratingOnly: !!checkInOptions?.ratingOnly });
    if (blocked) {
      throw Object.assign(new Error(BLOCK_MESSAGES[blocked]), { userMessage: BLOCK_MESSAGES[blocked], code: `checkin/${blocked}` });
    }
    setCheckingIn(landmark.id);
    try {
      const ratingOnly = !!checkInOptions?.ratingOnly;
      const points = ratingOnly ? 0 : landmark.points ?? POINTS_PER_CHECKIN;
      const landmarkCoords = landmark.lat != null && landmark.lng != null ? { lat: landmark.lat, lng: landmark.lng } : null;
      const result = await claimCheckIn({
        userId: user.uid,
        // Never store the email on public leaderboards — prefer the username.
        userName: myUsername || user.displayName || 'Explorer',
        landmarkId: landmark.id,
        landmarkName: landmark.name,
        region: landmark.regionId ?? landmark.region,
        points,
        ratingOnly,
        homeCoords: myProfile?.homeCoords || null,
        landmarkCoords,
        location: ratingOnly ? null : checkinLocationFields(fix, landmark),
      });
      // Only a real (non-ratingOnly) attempt marks the map/UI as "checked in"
      // here -- a ratingOnly claim never should, even if it's the one that
      // just created the underlying checkins doc (Firestore rules require
      // one to exist before a review can be written -- see firestore.rules
      // -- so the doc itself is unavoidable, but the visual "you've been
      // here" state is not). If you rate first and physically check in
      // later, that later real attempt is what finally marks it claimed.
      if (!ratingOnly && (result.claimed || result.alreadyClaimed)) {
        setClaimedMap((m) => ({ ...m, [landmark.id]: true }));
      }
      // Celebrate off the actual payout, not the base point value -- a
      // home-radius or 6th+ repeat visit pays 0 and has nothing to celebrate.
      if (result.claimed && result.payout > 0) {
        setCelebration(buildCelebration(result.payout));
      } else if (!ratingOnly) {
        // Paid nothing (6th+ repeat visit, or a duplicate claim): record that
        // explicitly so the success panel doesn't fall back to showing the
        // landmark's base value as if it had been earned.
        setCelebration({ points: 0, rank: null, message: null });
      }
      // Only a brand-new claim has a visitNumber worth checking -- a repeat
      // tap on an already-claimed check-in (result.alreadyClaimed) never
      // re-fires this, since nothing new was actually logged.
      if (!ratingOnly && result.claimed && shouldPromptLoveReason(result.visitNumber)) {
        setLoveReasonPrompt({ landmark, visitNumber: result.visitNumber });
      }
      return result;
    } finally {
      setCheckingIn(null);
    }
  };

  // Closes the prompt. If Post was never tapped, nothing was ever claimed —
  // this is a true cancel, not a "skip the rating but keep the check-in".
  const clearJustCheckedIn = () => {
    setJustCheckedIn(null);
    setCelebration(null);
    setCheckInOptions({});
  };

  const clearLoveReasonPrompt = () => setLoveReasonPrompt(null);

  return (
    <CheckInContext.Provider
      value={{
        user,
        firebaseEnabled,
        claimedMap,
        claimedLoaded,
        checkingIn,
        checkIn,
        commitCheckIn,
        justCheckedIn,
        checkInOptions,
        celebration,
        clearJustCheckedIn,
        loveReasonPrompt,
        clearLoveReasonPrompt,
      }}
    >
      {children}
    </CheckInContext.Provider>
  );
}
