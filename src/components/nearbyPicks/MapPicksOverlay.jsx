import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { useFriends } from '../../lib/FriendsContext';
import { useRatings } from '../../lib/RatingsContext';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { getUserCheckins, isRealCheckin } from '../../lib/leaderboard';
import { ALL_LANDMARKS } from '../../data/regions';
import {
  DEFAULT_DISTANCE_MI,
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
} from '../../lib/nearbyPicks';
import { buildPreferenceChains, checkinTimeMs, primaryCategory } from '../../lib/preferenceChains';
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

export default function MapPicksOverlay({ hidden = false, coords, geoError, expanded, onExpandedChange, minimized, onMinimizedChange }) {
  const { user } = useAuth();
  const { myProfile } = useFriends();
  const { ratings, myReviews } = useRatings();
  const online = useOnlineStatus();
  const uid = user?.uid || null;

  const [miles, setMiles] = useState(DEFAULT_DISTANCE_MI);
  const [now] = useState(() => Date.now());
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

  // Still waiting on the first GPS fix: skeletons, not "turn on location".
  const state = locked ? 'locked' : !origin && geoError ? 'no-location' : 'ready';

  const { picks, updating, slow, usual } = useNearbyPicks({
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
  });

  const pool = useMemo(
    () => (state === 'ready' && origin ? eligiblePlaces({ origin, miles, lowRated: lowRatedIds(myReviews), date: new Date(now) }) : []),
    [state, origin, miles, myReviews, now]
  );
  const shownKeys = useMemo(() => (picks || []).map(pickKey), [picks]);
  const liked = useMemo(() => lovedSeed(myReviews), [myReviews]);
  const similar = useMemo(() => similarPlaces({ liked, pool, exclude: shownKeys }), [liked, pool, shownKeys]);
  const meal = useMemo(() => (isMealTime(new Date(now)) ? mealPicks({ pool, ratings }) : []), [pool, ratings, now]);
  const interest = useMemo(() => {
    const p = nearbyInterest({ usual: usual.filter((u) => !shownKeys.includes(pickKey(u))) });
    return p ? { ...p, reason: 'One of your favorite kinds of places, just around the corner.' } : null;
  }, [usual, shownKeys]);

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
        distanceMiles={miles}
        toolbar={<DistanceFilter value={miles} onChange={setMiles} />}
      >
        <BecauseYouLikedRow liked={liked} places={similar} />
        <MoodCarousel pool={pool} ratings={ratings} />
        <MealCard places={meal} />
        <NearbyInterestCard place={interest} />
      </PicksBottomSheet>
    </div>
  );
}
