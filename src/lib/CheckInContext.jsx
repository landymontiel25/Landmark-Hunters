import { isOffline } from './friendlyError';
import { freshFix } from './verifyPresence';
import { canCheckInOffline, queueOfflineCheckin, OFFLINE_LIMIT_MESSAGE, OFFLINE_NEEDS_GPS_MESSAGE, OFFLINE_CHECKIN_SYNCED_EVENT } from './offlineCheckins';
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
import { verifyCheckinPresence } from './verifyPresence';
import { checksInAnywhere } from './admins';

// Shared check-in state so there's ONE source of truth and a single place to
// trigger the "rate + post" prompt, no matter which screen you checked in
// from (map pin, itinerary, landmark list, or detail page).
export const CheckInContext = createContext(null);

export function CheckInProvider({ children }) {
  const { user, firebaseEnabled } = useAuth();
  const { myUsername, myProfile } = useFriends();
  const [claimedMap, setClaimedMap] = useState({});
  // Bumps on every real check-in, so a page already showing "checked in"
  // (a repeat visit) knows to re-read its visit count.
  const [checkinTick, setCheckinTick] = useState(0);
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
  // The server's answer for the check-in just posted:
  // { checkinId, landmarkId, verified, reason, distanceMeters }, or null.
  const [presenceResult, setPresenceResult] = useState(null);
  const latestCheckinId = useRef({});

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

  // A check-in made offline that just synced (OutboxSync): it's a real visit
  // now, so the place reads as checked in.
  useEffect(() => {
    const onSynced = (e) => {
      const id = e?.detail?.landmarkId;
      if (!id || !e.detail.saved) return;
      setClaimedMap((m) => ({ ...m, [id]: true }));
      setCheckinTick((t) => t + 1);
    };
    window.addEventListener(OFFLINE_CHECKIN_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OFFLINE_CHECKIN_SYNCED_EVENT, onSynced);
  }, []);

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
  // Every real check-in is saved 'unverified'; right after, the server is
  // asked to verify it (verifyPresence.js, api/verify-checkin.js) and its
  // answer lands in `presence` (shown as "Verified visit"). The check-in
  // never waits for that. With REQUIRE_GPS_CHECKIN on, one that fails the
  // client rule is refused.
  // `offline`: { review, photos } to keep with a check-in saved on the phone
  // when there's no internet (offlineCheckins.js); the server verifies and
  // pays once it syncs.
  const commitCheckIn = async (fix = null, offline = {}) => {
    const landmark = justCheckedIn;
    if (!user || !landmark) return null;
    if (!checkInOptions?.ratingOnly && isOffline()) {
      if (!canCheckInOffline(user.uid)) throw Object.assign(new Error(OFFLINE_LIMIT_MESSAGE), { userMessage: OFFLINE_LIMIT_MESSAGE, code: 'checkin/offline-limit' });
      // GPS works without internet: a fresh fix for this exact moment.
      const now = await freshFix().catch(() => null);
      const at = now || (fix && Number.isFinite(fix.lat) ? { lat: fix.lat, lng: fix.lng, accuracy: Number.isFinite(fix.accuracy) ? fix.accuracy : 9999, timestamp: Date.now() } : null);
      if (!at) throw Object.assign(new Error(OFFLINE_NEEDS_GPS_MESSAGE), { userMessage: OFFLINE_NEEDS_GPS_MESSAGE, code: 'checkin/offline-no-gps' });
      const job = await queueOfflineCheckin({ uid: user.uid, landmark, fix: at, review: offline.review || null, photos: offline.photos || [] });
      setCelebration({ points: 0, rank: null, message: null });
      return { claimed: false, queuedOffline: true, jobId: job.id, payout: 0 };
    }
    const blocked = checkinBlockReason(fix, landmark, { ratingOnly: !!checkInOptions?.ratingOnly, anywhere: checksInAnywhere(user) });
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
        setCheckinTick((t) => t + 1);
      }
      // The server verifies the visit and is the only one that pays
      // (api/verify-checkin.js): the check-in waits for its answer (at most
      // VERIFY_TIMEOUT_MS) so the points shown are the points paid.
      let paid = 0;
      if (!ratingOnly && result.claimed && result.checkinId) {
        // A verified result belongs to one check-in: a new one clears it, and
        // only the newest check-in's answer may land.
        setPresenceResult(null);
        const checkinId = result.checkinId;
        latestCheckinId.current = { ...latestCheckinId.current, [landmark.id]: checkinId };
        const v = await verifyCheckinPresence(checkinId, { anywhere: checksInAnywhere(user) });
        // A late answer for an earlier check-in at the same place never
        // lands on a newer one there.
        if (v && latestCheckinId.current[landmark.id] === checkinId) {
          setPresenceResult({ checkinId, landmarkId: landmark.id, ...v });
          setCheckinTick((t) => t + 1);
          paid = Number(v.awarded) || 0;
        }
      }
      // Celebrate off what the server paid, never the base point value.
      if (result.claimed && paid > 0) {
        setCelebration(buildCelebration(paid));
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
      return { ...result, payout: paid };
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
        checkinTick,
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
        presenceResult,
      }}
    >
      {children}
    </CheckInContext.Provider>
  );
}
