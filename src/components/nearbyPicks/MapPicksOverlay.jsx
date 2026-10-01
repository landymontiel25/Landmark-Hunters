import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { useFriends } from '../../lib/FriendsContext';
import { useRatings } from '../../lib/RatingsContext';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { getUserCheckins, isRealCheckin } from '../../lib/leaderboard';
import { ALL_LANDMARKS } from '../../data/regions';
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
  unratedPlaces,
  SHEET_PICKS,
} from '../../lib/nearbyPicks';
import { buildPreferenceChains, checkinTimeMs, primaryCategory } from '../../lib/preferenceChains';
import { useUnits } from '../../lib/UnitsContext';
import { distanceMeters } from '../../lib/geo';
import { useNearbyPicks } from './useNearbyPicks';
import PicksBottomSheet from './PicksBottomSheet';
import DistanceFilter from './DistanceFilter';
import BecauseYouLikedRow from './BecauseYouLikedRow';
import MoodCarousel from './MoodCarousel';
import MealCard from './MealCard';
import NearbyInterestCard from './NearbyInterestCard';
import './nearbyPicks.css';

// "Picked for you right now" over the Map tab's live map: the top three
// picks when the Map opens, swipe up for the full list and the rows under
// it. Built from the signed-in account's own ratings, tag scores and
// check-ins, around the device's live location (coords from MapExplore's
// useGeo). Everything it shows is real: under 10 ratings it asks for more,
// with location off it asks for location, an old cached set shows with
// "Updating...", and offline the last set stays up.

const byKey = new Map(ALL_LANDMARKS.map((l) => [`${l.regionId}/${l.id}`, l]));
const byId = new Map(ALL_LANDMARKS.map((l) => [l.id, l]));
const landmarkOf = (c) => byKey.get(`${c.region}/${c.landmarkId}`) || byId.get(c.landmarkId) || null;
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

  const { picks: builtPicks, updating, slow, usual, showDifferent, refreshing } = useNearbyPicks({
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
  const similar = useMemo(() => similarPlaces({ liked, pool: unrated, exclude: shownKeys }), [liked, unrated, shownKeys]);
  const meal = useMemo(() => (isMealTime(new Date(now)) ? mealPicks({ pool: unrated, ratings }) : []), [unrated, ratings, now]);
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
        moodSlot={showRefresh ? <MoodCarousel pool={pool} ratings={ratings} moods={TEST_MOODS} /> : null}
        onRefresh={showRefresh && online ? showDifferent : null}
        refreshing={refreshing}
        toolbar={<DistanceFilter value={distance} onChange={chooseDistance} />}
      >
        <BecauseYouLikedRow liked={liked} places={similar} />
        {!showRefresh && <MoodCarousel pool={pool} ratings={ratings} />}
        {!showRefresh && <MealCard places={meal} />}
        {!showRefresh && <NearbyInterestCard place={interest} />}
      </PicksBottomSheet>
    </div>
  );
}
