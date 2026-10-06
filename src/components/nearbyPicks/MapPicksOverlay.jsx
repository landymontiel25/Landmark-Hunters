import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { useFriends } from '../../lib/FriendsContext';
import { useRatings } from '../../lib/RatingsContext';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { getUserCheckins, isRealCheckin } from '../../lib/leaderboard';
import { ALL_LANDMARKS, getLandmark } from '../../data/regions';
import {
  widenChip,
  fallbackReason,
  nearestBeyond,
  optionToMiles,
  readStoredDistance,
  smartDistance,
  TEST_DEFAULT_DISTANCE_MI,
  TEST_MOODS,
  writeStoredDistance,
  MIN_RATINGS_FOR_PICKS,
  eligiblePlaces,
  isMealTime,
  lovedSeed,
  lowRatedIds,
  mealPicks,
  nearbyInterest,
  pickKey,
  ratingsCountOf,
  similarPlaces,
  SIMILAR_MIN_MI,
  unratedPlaces,
  SHEET_PICKS,
  regionsWithin,
} from '../../lib/nearbyPicks';
import { buildPreferenceChains, checkinTimeMs, primaryCategory } from '../../lib/preferenceChains';
import { useUnits } from '../../lib/UnitsContext';
import { distanceMeters } from '../../lib/geo';
import { useNearbyPicks } from './useNearbyPicks';
import { useShownLogger } from '../../lib/useShownLogger';
import PicksBottomSheet from './PicksBottomSheet';
import DistanceFilter from './DistanceFilter';
import BecauseYouLikedRow from './BecauseYouLikedRow';
import MoodCarousel from './MoodCarousel';
import MealCard from './MealCard';
import NearbyInterestCard from './NearbyInterestCard';
import ShakeUpCard from './ShakeUpCard';
import { loadMaprModels } from '../../lib/maprRank/modelStore.js';
import { readSeen } from '../../lib/maprRank/seenHistory.js';
import { readLocalFeedback } from '../../lib/pickFeedback';
import { rankPlaces, loggable } from '../../lib/maprRank/surfaces.js';
import { makeSetId } from '../../lib/setId';
import './nearbyPicks.css';

// "Picked for you right now" over the Map tab's live map: the top three
// picks when the Map opens, swipe up for the full list and the rows under
// it. Built from the signed-in account's own ratings, tag scores and
// check-ins, around the device's live location (coords from MapExplore's
// useGeo). Everything it shows is real: under 10 ratings it asks for more,
// with location off it asks for location, an old cached set shows with
// "Updating...", and offline the last set stays up.

const landmarkOf = (c) => getLandmark(c.region, c.landmarkId) || ALL_LANDMARKS.find((l) => l.id === c.landmarkId) || null;
const categoryOf = (c) => primaryCategory(landmarkOf(c)?.categories);
const NO_COUNTS = {};

// ~110 m: a GPS tick while standing still doesn't re-rank anything.
const round3 = (n) => Math.round(n * 1000) / 1000;

export default function MapPicksOverlay({ hidden = false, coords, geoError, overrides = null, customLandmarks = null, expanded, onExpandedChange, minimized, onMinimizedChange, showRefresh = false }) {
  const { user } = useAuth();
  const { myProfile } = useFriends();
  const { ratings, myReviews } = useRatings();
  const online = useOnlineStatus();
  const uid = user?.uid || null;

  const { units } = useUnits();
  // The chip number (10 = 10 mi or 10 km, per the units setting). `chosen`
  // is what the user tapped (remembered per account); until they tap one the
  // distance is the smallest chip with at least 3 places (smartDistance), so
  // the pill and chips always show the distance actually searched.
  // The Test tab (showRefresh) starts at TEST_DEFAULT_DISTANCE_MI and keeps its
  // own remembered choice, so trying it never changes the real Map's distance.
  const store = showRefresh && uid ? `${uid}:test` : uid;
  const [chosen, setChosen] = useState(() => readStoredDistance(store));
  const [storedFor, setStoredFor] = useState(store);
  if (storedFor !== store) {
    setStoredFor(store);
    setChosen(readStoredDistance(store));
  }
  const chooseDistance = (n) => {
    setChosen(n);
    writeStoredDistance(store, n);
  };
  // The overlay stays mounted while the app is open, so "now" has to move:
  // a frozen clock never showed the lunch card after a morning launch.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10 * 60 * 1000);
    // Coming back to the app after a while: the timer was paused with the tab.
    const onVisible = () => document.visibilityState === 'visible' && setNow(Date.now());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  const [checkins, setCheckins] = useState([]);

  const ratingsCount = ratingsCountOf(myReviews);
  const locked = ratingsCount < MIN_RATINGS_FOR_PICKS;

  // Check-ins only matter once there are picks to chain.
  useEffect(() => {
    if (!uid || locked) return undefined;
    let cancelled = false;
    getUserCheckins(uid)
      .then((rows) => !cancelled && setCheckins(rows || []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uid, locked]);

  const links = useMemo(() => buildPreferenceChains(checkins, { categoryOf }), [checkins]);
  const lastCategory = useMemo(() => {
    const latest = checkins
      .filter(isRealCheckin)
      .sort((a, b) => (checkinTimeMs(b) || 0) - (checkinTimeMs(a) || 0))[0];
    return latest ? categoryOf(latest) : null;
  }, [checkins]);

  const lat = coords ? round3(coords.lat) : null;
  const lng = coords ? round3(coords.lng) : null;
  const origin = useMemo(() => (lat != null ? { lat, lng } : null), [lat, lng]);

  const lowRated = useMemo(() => lowRatedIds(myReviews), [myReviews]);
  const auto = useMemo(
    () => smartDistance({ origin, units, lowRated, date: new Date(now), overrides, extraPlaces: customLandmarks }),
    [origin, units, lowRated, now, overrides, customLandmarks]
  );
  const distance = chosen ?? (showRefresh ? TEST_DEFAULT_DISTANCE_MI : auto);
  const miles = optionToMiles(distance, units);

  // Still waiting on the first GPS fix: skeletons, not "turn on location".
  const state = locked ? 'locked' : !origin && geoError ? 'no-location' : 'ready';

  // Mapr Phase 1 (src/lib/maprRank): the models the nightly job publishes,
  // for the regions inside the distance; null until loaded (ranking works
  // without them).
  const regionKey = useMemo(() => (origin ? regionsWithin(origin, miles).sort().join(',') : ''), [origin, miles]);
  const [models, setModels] = useState(null);
  useEffect(() => {
    if (!uid || locked || !regionKey) return undefined;
    let cancelled = false;
    loadMaprModels({ uid, regions: regionKey.split(',') })
      .then((m) => !cancelled && setModels(m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uid, locked, regionKey]);
  const visitedIds = useMemo(() => new Set(checkins.filter(isRealCheckin).map((c) => c.landmarkId)), [checkins]);
  const createdAtMs = myProfile?.createdAt?.seconds != null ? myProfile.createdAt.seconds * 1000 : Number.isFinite(myProfile?.createdAt) ? myProfile.createdAt : null;
  // Re-read on each clock tick so a set built later sees what was shown since.
  const explore = useMemo(
    () => (uid ? { createdAtMs, shown: readSeen(uid), votes: readLocalFeedback(uid), ratings, serverStagnating: models?.serverStagnating === true } : null),
    [uid, createdAtMs, ratings, models, now] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { picks: builtPicks, setId, updating, slow, usual, showDifferent, refreshing, stagnating } = useNearbyPicks({
    uid,
    enabled: state === 'ready' && !!origin,
    online,
    profile: myProfile,
    origin,
    miles,
    myReviews,
    checkinCounts: NO_COUNTS,
    links,
    lastCategory,
    now,
    overrides,
    extraPlaces: customLandmarks,
    fillNew: showRefresh,
    models,
    visitedIds,
    explore,
  });

  // A saved set keeps the distances from when it was built, which is up to
  // ~1 km (one cache cell) and 4 hours from where you are now.
  const picks = useMemo(
    () =>
      builtPicks && coords
        ? builtPicks.map((p) => {
            if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return p;
            const q = { ...p, distanceMeters: distanceMeters(coords.lat, coords.lng, p.lat, p.lng) };
            // The plain reason line carries the distance, so it is rebuilt
            // from the live one, in the Units setting's unit.
            return p.reasonSource === 'fallback' ? { ...q, reason: fallbackReason(q, units) } : q;
          })
        : builtPicks,
    [builtPicks, coords?.lat, coords?.lng, units] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const pool = useMemo(
    () => (state === 'ready' && origin ? eligiblePlaces({ origin, miles, lowRated, date: new Date(now), overrides, extraPlaces: customLandmarks }) : []),
    [state, origin, miles, lowRated, now, overrides, customLandmarks]
  );
  const shownKeys = useMemo(() => (picks || []).map(pickKey), [picks]);
  const liked = useMemo(() => lovedSeed(myReviews), [myReviews]);
  const unrated = useMemo(() => unratedPlaces(pool, myReviews), [pool, myReviews]);
  // "Because you liked X" wants the same kind of place (another steakhouse),
  // which is rarer than "any food", so it looks out to SIMILAR_MIN_MI even
  // when the picks distance is smaller.
  const similarPool = useMemo(
    () =>
      state === 'ready' && origin
        ? miles >= SIMILAR_MIN_MI
          ? pool
          : eligiblePlaces({ origin, miles: SIMILAR_MIN_MI, lowRated, date: new Date(now), overrides, extraPlaces: customLandmarks })
        : [],
    [state, origin, miles, pool, lowRated, now, overrides, customLandmarks]
  );
  const similarUnrated = useMemo(() => unratedPlaces(similarPool, myReviews), [similarPool, myReviews]);
  // Mapr Phase 1 on the sheet's other rows too (maprRank/surfaces.js): each
  // row keeps its own meaning (same kind as X, this mood, food) and Mapr
  // orders it by taste, distance, similar places and the model.
  const rankRow = useCallback(
    (items, scoreOf = null) =>
      rankPlaces({ places: items || [], uid, profile: myProfile, myReviews, origin, models, visitedIds, now, ...(scoreOf ? { scoreOf } : {}) }).ranked,
    [uid, myProfile, myReviews, origin, models, visitedIds, now]
  );
  const similar = useMemo(
    () => rankRow(similarPlaces({ liked, pool: similarUnrated, exclude: shownKeys, limit: 12 }), (p) => p.similarity || 0),
    [liked, similarUnrated, shownKeys, rankRow]
  );
  // Public rating order stays the tie-break (ranking keeps the incoming order on ties).
  const meal = useMemo(() => (isMealTime(new Date(now)) ? rankRow(mealPicks({ pool: unrated, ratings, limit: 12 })) : []), [unrated, ratings, now, rankRow]);
  const interest = useMemo(() => {
    const p = nearbyInterest({ usual: usual.filter((u) => !shownKeys.includes(pickKey(u))) });
    return p ? { ...p, reason: 'One of your favorite kinds of places, just around the corner.' } : null;
  }, [usual, shownKeys]);

  // Thin or empty radius: the nearest few places past it, and the smallest
  // wider chip that reaches the first of them (null at the biggest chip).
  const beyond = useMemo(() => {
    if (state !== 'ready' || !origin || !picks || picks.length >= SHEET_PICKS) return null;
    const places = nearestBeyond({ origin, miles, lowRated, date: new Date(now), overrides, extraPlaces: customLandmarks });
    const widenTo = widenChip(places, distance, units);
    return { places, widenTo };
  }, [state, origin, picks, miles, distance, units, lowRated, now, overrides, customLandmarks]);

  // Log each card once, the first time it is on screen in this set.
  const logShown = useShownLogger({ uid, profile: myProfile, surface: 'map-sheet', source: 'map-picks', isTest: showRefresh });
  // The other rows log their cards as picks too (same surface, own source),
  // one set per distinct list a row shows.
  const logRow = useShownLogger({ uid, profile: myProfile, surface: 'map-sheet', isTest: showRefresh });
  const rowLogger = useCallback(
    (source) => (hidden ? null : (items) => logRow(makeSetId(uid), items.map((p, i) => loggable(p, i + 1)), { source })),
    [hidden, logRow, uid]
  );
  const onSimilarShown = useMemo(() => rowLogger('because-you-liked'), [rowLogger]);
  const onMoodShown = useMemo(() => rowLogger('mood'), [rowLogger]);
  const onMealShown = useMemo(() => rowLogger('meal'), [rowLogger]);
  const onInterestShown = useMemo(() => rowLogger('nearby-interest'), [rowLogger]);
  const onShown = useMemo(
    () => (hidden || !setId ? null : (visible) => logShown(setId, visible)),
    [hidden, setId, logShown]
  );

  // MapExplore only mounts this signed in, once the account's own ratings
  // have loaded (so a new account isn't confused with one mid-load).
  if (!uid) return null;

  return (
    <div className="map-picks" hidden={hidden}>
      <PicksBottomSheet
        state={state}
        picks={picks}
        updating={state === 'ready' && updating}
        slow={state === 'ready' && slow}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        minimized={minimized}
        onMinimizedChange={onMinimizedChange}
        distanceMiles={distance}
        beyond={beyond}
        onWiden={chooseDistance}
        ratingsCount={ratingsCount}
        layout={showRefresh ? 'mood-first' : 'default'}
        moodSlot={showRefresh ? <MoodCarousel pool={pool} ratings={ratings} moods={TEST_MOODS} rank={rankRow} onShown={onMoodShown} /> : null}
        onRefresh={showRefresh && online ? showDifferent : null}
        refreshing={refreshing}
        onShown={onShown}
        uid={showRefresh ? null : uid}
        origin={origin}
        toolbar={<DistanceFilter value={distance} onChange={chooseDistance} />}
      >
        {!showRefresh && <ShakeUpCard uid={uid} show={stagnating && online} onShake={showDifferent} />}
        <BecauseYouLikedRow liked={liked} places={similar} uid={uid} origin={origin} onShown={onSimilarShown} />
        {!showRefresh && <MoodCarousel pool={pool} ratings={ratings} rank={rankRow} onShown={onMoodShown} />}
        {!showRefresh && <MealCard places={meal} onShown={onMealShown} />}
        {!showRefresh && <NearbyInterestCard place={interest} onShown={onInterestShown} />}
      </PicksBottomSheet>
    </div>
  );
}
