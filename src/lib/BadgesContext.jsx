import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext';
import { useFriends } from './FriendsContext';
import { useCheckIn } from './useCheckIn';
import { useTrip } from './TripContext';
import { getUserStats, getUserCheckins, isInTopLeaderboard, hasFriendTagTeam, isRealCheckin } from './leaderboard';
import { getPickFeedback } from './pickFeedback';
import { getUserReviews } from './reviews';
import { getCustomLandmarks } from './customLandmarks';
import { ensurePlacePacks, isPlacePackId } from './placePacks';
import { getRegion, getLandmark } from '../data/regions';
import { computeBadges, computeStreakDays, hasSecuredStreakToday, msUntilStreakLapse, todaysActionCount } from './streaks';
import {
  countPhotoCheckins,
  maxRegionCheckins,
  countDistinctStates,
  countDistinctCountries,
  hasNightOwlCheckin,
  hasGoldenHourCheckin,
  countCuisineTypes,
  hasAllStarWeek,
} from './badgeStats';
import { hasCompletedOnboardingLocally } from './onboarding';
import { claimFreshBadges, releaseBadges } from './badgeCelebration';

// Your check-in/city/streak counts and the badges earned from them -- one
// shared fetch + one shared "what's newly earned" detector, so Profile's
// badge pills, Full Stats, and the celebration popup (CelebrationOverlay)
// all agree on the same state instead of racing three independent copies
// of this same logic against the same badgeEarnedAt write.
const BadgesContext = createContext(null);

// Belt-and-suspenders against the "same badge celebrates again" bug, which
// has come back more than once from timing races upstream (a cache read,
// a re-fetch, a user-reference change) that looked fixed each time but
// weren't exhaustively provable. This is a hard, unconditional guarantee
// instead of one more attempt to get the race exactly right: once a
// badge has ever been queued for celebration on this device for this
// account, it is never queued again -- permanently, regardless of what
// upstream state does. Deliberately per-device (localStorage, not
// Firestore) since the goal is just "never show this popup twice here."
const CELEBRATED_PREFIX = 'landmarkhunters.celebrated.';
function hasCelebrated(uid, badgeId) {
  try {
    return localStorage.getItem(`${CELEBRATED_PREFIX}${uid}.${badgeId}`) === '1';
  } catch {
    return false;
  }
}
function markCelebrated(uid, badgeId) {
  try {
    localStorage.setItem(`${CELEBRATED_PREFIX}${uid}.${badgeId}`, '1');
  } catch {
    /* storage full/disabled -- non-fatal, this guard just gets skipped */
  }
}

// Resolves a check-in to the state/country/categories of the landmark it
// was for, for the geographic-coverage and variety-challenge badges below.
// customLandmarksById covers user-submitted spots the built-in catalog
// doesn't know about; a check-in this can't resolve at all (a landmark that
// got removed, say) is simply left without those fields, not guessed at.
function annotateCheckin(c, customLandmarksById) {
  const region = getRegion(c.region);
  const builtIn = getLandmark(c.region, c.landmarkId);
  const custom = !builtIn ? customLandmarksById.get(c.landmarkId) : null;
  return {
    ...c,
    state: region?.state || null,
    country: region?.country || null,
    categories: builtIn?.categories || custom?.categories || [],
  };
}

export function BadgesProvider({ children }) {
  const { user, firebaseEnabled } = useAuth();
  const { claimedMap } = useCheckIn();
  const { myProfile, profileFresh, friendUids, reload: reloadFriends } = useFriends();
  const { trip } = useTrip();
  const [stats, setStats] = useState(null);
  const [streakDays, setStreakDays] = useState(0);
  // Whether today's streak is already secured -- a real check-in, or
  // PICKS_STREAK_THRESHOLD Mapr Picks votes (see streaks.js). Despite the
  // name this is broader than "checked in" on purpose: it's "is the streak
  // safe today", which is the only thing either caller of this actually
  // wants to know.
  const [checkedInToday, setCheckedInToday] = useState(false);
  // Distinct landmarks voted/rated today, toward PICKS_STREAK_THRESHOLD --
  // for the "X/3 today" counter near Mapr Picks.
  const [actionsToday, setActionsToday] = useState(0);
  // Everything past the original 4 (checkins/cities/streak/milestone) that
  // ALL_BADGES' newer entries check against -- see badgeStats.js and the
  // leaderboard.js helpers for how each one is actually derived. Best-effort
  // as a whole: a failure here degrades to "nothing new earned this load"
  // rather than breaking the rest of Profile/Full Stats.
  const [extra, setExtra] = useState({});
  // Badges this session has seen freshly persisted (not yet in
  // myProfile.badgeEarnedAt at the moment they were computed) -- consumed
  // by CelebrationOverlay, which dismisses each one after showing it.
  const [justEarned, setJustEarned] = useState([]);
  // Badge ids this session has already started writing/queuing (see
  // badgeCelebration.js): stops a re-run of the detector below from writing
  // and celebrating the same badge again while the first write is in flight.
  const claimedRef = useRef(new Set());

  // Popups queued for one account must never play for the next one signed in
  // on the same device.
  const uidRef = useRef(null);
  uidRef.current = user?.uid ?? null;
  useEffect(() => {
    setJustEarned([]);
  }, [user?.uid]);

  // Pulled out of the effect (and exposed as `reload`) so voting on a Mapr
  // Pick can refresh the streak the moment a day's 5th vote lands, instead
  // of waiting for claimedMap to change (which a vote never does).
  const load = useCallback(async () => {
    if (!firebaseEnabled || !user) {
      setStats(null);
      setStreakDays(0);
      setCheckedInToday(false);
      setActionsToday(0);
      setExtra({});
      return;
    }
    let s;
    try {
      s = await getUserStats(user.uid);
    } catch {
      // `failed` lets screens say "couldn't load" instead of presenting these
      // zeros as the traveler's real history.
      s = { totalPoints: 0, checkins: 0, cities: 0, cityIds: [], cityLastVisit: {}, cityPoints: {}, failed: true };
    }
    setStats(s);
    let rows = [];
    try {
      const [checkinRows, feedback] = await Promise.all([getUserCheckins(user.uid), getPickFeedback(user.uid)]);
      rows = checkinRows;
      const fbList = Object.values(feedback || {});
      setStreakDays(computeStreakDays(rows, new Date(), fbList));
      setCheckedInToday(hasSecuredStreakToday(rows, fbList));
      setActionsToday(todaysActionCount(rows, fbList));
    } catch {
      setStreakDays(0);
      setCheckedInToday(false);
      setActionsToday(0);
    }

    try {
      const [reviews, allCustom] = await Promise.all([
        getUserReviews(user.uid).catch(() => []),
        getCustomLandmarks().catch(() => []),
        rows.some((c) => isPlacePackId(c.landmarkId)) ? ensurePlacePacks() : null,
      ]);
      const customLandmarksById = new Map(allCustom.map((l) => [l.id, l]));
      const factLandmarks = allCustom.filter((l) => l.createdBy === user.uid && (l.facts || []).length > 0).length;
      // Badges say "Checked in...": 0-point "Rate a Landmark" claims are
      // ratings, not visits, so they don't count toward any of them.
      const visits = rows.filter(isRealCheckin);
      const annotated = visits.map((c) => annotateCheckin(c, customLandmarksById));
      const friendUidList = [...friendUids];

      const [top10, tagTeam] = await Promise.all([
        isInTopLeaderboard(user.uid).catch(() => false),
        hasFriendTagTeam(user.uid, friendUidList, visits).catch(() => false),
      ]);

      // byRegion also holds Mapr-found places' ids once Edit List has saved an
      // order; only catalog landmarks count toward the badge.
      const tripLandmarks = Math.max(
        0,
        ...Object.entries(trip.byRegion || {}).map(([rid, ids]) => {
          const known = new Set((getRegion(rid)?.landmarks || []).map((l) => l.id));
          return ids.filter((id) => known.has(id)).length;
        })
      );

      setExtra({
        photoCheckins: countPhotoCheckins(visits),
        // Reviewer needs a place you actually visited: you can rate places
        // without checking in, but the badge is for reviews of real visits.
        fiveStarReview: reviews.some(
          (r) => r.ratingTier === 'highly-recommend' && rows.some((c) => c.landmarkId === r.landmarkId && isRealCheckin(c))
        ),
        factLandmarks,
        friends: friendUidList.length,
        top10,
        tagTeam,
        regionMax: maxRegionCheckins(visits),
        states: countDistinctStates(annotated),
        countries: countDistinctCountries(annotated),
        tripLandmarks,
        allStarWeek: hasAllStarWeek(annotated),
        cuisineTypes: countCuisineTypes(annotated),
        nightOwl: hasNightOwlCheckin(visits),
        goldenHour: hasGoldenHourCheckin(visits),
      });
    } catch {
      // Best-effort -- the original 4 badge kinds (and everything else on
      // Profile) still work even if this whole block fails.
      setExtra({});
    }
  }, [firebaseEnabled, user, friendUids, trip.byRegion]);

  // On launch the friend list, trips and check-in map each arrive a moment
  // apart and each changes `load`; running the whole multi-read badge pass once
  // per arrival (3x) was most of the startup Firestore traffic. Wait for the
  // burst to settle and run it once.
  useEffect(() => {
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [load, claimedMap]);

  // A tab left open overnight (common on desktop) otherwise keeps
  // yesterday's streak and "secured today" until something else reloads.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    const t = setTimeout(load, msUntilStreakLapse() + 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(t);
    };
  }, [load]);

  // Derived from state rather than fetched separately, so completing
  // onboarding (which flips myProfile.onboardingCompleted, not the
  // check-in history) surfaces the Welcome badge immediately, with no
  // extra Firestore reads.
  // Also true if the local guard says so (see onboarding.js) -- keeps this
  // in sync with Profile's own onboardingDone check so the Welcome badge
  // can't show as earned in Profile but unearned in Full Stats, or vice
  // versa, purely because of whatever's keeping the Firestore flag from
  // sticking.
  const onboardingDone = !!myProfile?.onboardingCompleted || (!!user && hasCompletedOnboardingLocally(user.uid));
  const badges = useMemo(() => {
    if (!stats) return [];
    return computeBadges({
      checkinsCount: stats.checkins,
      citiesCount: stats.cities,
      streakDays,
      onboardingCompleted: onboardingDone,
      extra,
    });
  }, [stats, streakDays, onboardingDone, extra]);

  // Same shape computeBadges builds internally, exposed so Profile's
  // "closest badge" card can reason about every badge (not just the
  // original 4) instead of keeping its own out-of-sync partial copy.
  const badgeCounts = useMemo(
    () => ({
      checkins: stats?.checkins || 0,
      cities: stats?.cities || 0,
      streak: streakDays,
      milestone: onboardingDone ? 1 : 0,
      ...extra,
    }),
    [stats, streakDays, onboardingDone, extra]
  );

  // Wait for a real profile read (not just `user` existing) before deciding
  // what's "new" -- otherwise a still-loading myProfile looks like nothing
  // is recorded yet, and every already-earned badge would get re-stamped
  // (and re-celebrated) on every load.
  useEffect(() => {
    if (!user || !profileFresh || badges.length === 0) return;
    const known = myProfile.badgeEarnedAt || {};
    const fresh = claimFreshBadges({
      badges,
      known,
      uid: user.uid,
      celebrated: hasCelebrated,
      claimed: claimedRef.current,
    });
    if (fresh.length === 0) return;
    const patch = {};
    for (const b of fresh) patch[`badgeEarnedAt.${b.id}`] = serverTimestamp();
    updateDoc(doc(db, 'users', user.uid), patch)
      .then(() => {
        for (const b of fresh) markCelebrated(user.uid, b.id);
        // The write outlived a sign-out/account switch: its popup belongs to
        // the previous account and must not play for the next one.
        if (uidRef.current !== user.uid) return;
        // Dedupe against whatever's already queued -- guards a fast second
        // check-in whose "fresh" detection runs before myProfile reflects
        // this write, which would otherwise queue the same badge twice.
        setJustEarned((cur) => {
          const known = new Set(cur.map((b) => b.id));
          const additions = fresh.filter((b) => !known.has(b.id));
          return additions.length ? [...cur, ...additions] : cur;
        });
        reloadFriends();
      })
      .catch(() => releaseBadges({ badges: fresh, uid: user.uid, claimed: claimedRef.current }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profileFresh, badges, myProfile]);

  const dismissJustEarned = (id) => setJustEarned((cur) => cur.filter((b) => b.id !== id));

  const value = useMemo(
    () => ({
      stats,
      streakDays,
      checkedInToday,
      actionsToday,
      badges,
      badgeCounts,
      badgeEarnedAt: myProfile?.badgeEarnedAt || {},
      justEarned,
      dismissJustEarned,
      reload: load,
    }),
    [stats, streakDays, checkedInToday, actionsToday, badges, badgeCounts, myProfile?.badgeEarnedAt, justEarned, load]
  );

  return <BadgesContext.Provider value={value}>{children}</BadgesContext.Provider>;
}

export function useBadges() {
  const ctx = useContext(BadgesContext);
  if (!ctx) throw new Error('useBadges must be used inside BadgesProvider');
  return ctx;
}
