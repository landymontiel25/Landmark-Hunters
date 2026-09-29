import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { useFriends } from '../../lib/FriendsContext';
import { useRatings } from '../../lib/RatingsContext';
import { useGeo } from '../../lib/GeoContext';
import { getUserCheckins, isRealCheckin } from '../../lib/leaderboard';
import { ALL_LANDMARKS, INTERESTS } from '../../data/regions';
import {
  DEFAULT_DISTANCE_MI,
  LOCATION_PRESETS,
  MIN_RATINGS_FOR_PICKS,
  categoryLabel,
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
import { CHAIN_MIN_COUNT, CHAIN_WINDOW_MS, buildPreferenceChains, checkinTimeMs, primaryCategory } from '../../lib/preferenceChains';
import { useNearbyPicks } from './useNearbyPicks';
import PhoneFrame from './PhoneFrame';
import PreviewMap from './PreviewMap';
import PicksBottomSheet from './PicksBottomSheet';
import DistanceFilter from './DistanceFilter';
import BecauseYouLikedRow from './BecauseYouLikedRow';
import MoodCarousel from './MoodCarousel';
import MealCard from './MealCard';
import NearbyInterestCard from './NearbyInterestCard';
import { PreviewAsSwitcher, SimulateLocation } from './PreviewControls';
import './maprPicksPreview.css';

// Test tab: "Picked for you right now" as it would look on the Map tab when
// the app opens -- a phone-sized mock with a map behind it and the picks
// sheet on top -- built from this account's real ratings, tag scores and
// check-ins. Everything it logs is flagged isTest. It never writes to the
// real Map, Mapr, or Notifications screens; the pieces it's made of take
// their data as props, so they can move to those screens later.

const byKey = new Map(ALL_LANDMARKS.map((l) => [`${l.regionId}/${l.id}`, l]));
const byId = new Map(ALL_LANDMARKS.map((l) => [l.id, l]));
const landmarkOf = (c) => byKey.get(`${c.region}/${c.landmarkId}`) || byId.get(c.landmarkId) || null;
const categoryOf = (c) => primaryCategory(landmarkOf(c)?.categories);
const NO_COUNTS = {};

export default function MaprPicksPreview() {
  const { user } = useAuth();
  const { myProfile } = useFriends();
  const { ratings, myReviews } = useRatings();
  const { coords } = useGeo();
  const uid = user?.uid || null;

  const [previewAs, setPreviewAs] = useState('returning');
  const [presetId, setPresetId] = useState(null);
  const [miles, setMiles] = useState(DEFAULT_DISTANCE_MI);
  const [expanded, setExpanded] = useState(false);
  const [now] = useState(() => Date.now());
  const [checkins, setCheckins] = useState([]);
  // undefined: use the latest real check-in; null: pretend there's none.
  const [lastOverride, setLastOverride] = useState(undefined);

  useEffect(() => {
    if (!uid) return undefined;
    let cancelled = false;
    getUserCheckins(uid)
      .then((rows) => !cancelled && setCheckins(rows))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const links = useMemo(() => buildPreferenceChains(checkins, { categoryOf }), [checkins]);
  const realVisits = useMemo(() => checkins.filter(isRealCheckin), [checkins]);
  const visitedIds = useMemo(() => realVisits.map((c) => c.landmarkId), [realVisits]);
  const latestVisit = useMemo(
    () => [...realVisits].sort((a, b) => (checkinTimeMs(b) || 0) - (checkinTimeMs(a) || 0))[0] || null,
    [realVisits]
  );
  const historyLast = latestVisit ? categoryOf(latestVisit) : null;
  const lastCategory = lastOverride !== undefined ? lastOverride : historyLast;

  const preset = LOCATION_PRESETS.find((p) => p.id === presetId) || null;
  const lat = previewAs === 'location-off' ? null : preset ? preset.lat : coords?.lat ?? null;
  const lng = previewAs === 'location-off' ? null : preset ? preset.lng : coords?.lng ?? null;
  const origin = useMemo(() => (lat != null ? { lat, lng } : null), [lat, lng]);

  const ratingsCount = ratingsCountOf(myReviews);
  const locked = previewAs === 'new-user' || ratingsCount < MIN_RATINGS_FOR_PICKS;
  const state = !origin ? 'no-location' : locked ? 'locked' : 'ready';
  const mode = previewAs === 'old-cache' ? 'old-cache' : previewAs === 'slow' ? 'slow' : 'returning';

  const { picks, updating, usual, cachedAt, refresh } = useNearbyPicks({
    uid,
    enabled: state === 'ready',
    mode,
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
    () => (state === 'ready' ? eligiblePlaces({ origin, miles, lowRated: lowRatedIds(myReviews), date: new Date(now) }) : []),
    [state, origin, miles, myReviews, now]
  );
  const shownKeys = useMemo(() => (picks || []).map(pickKey), [picks]);
  const liked = useMemo(() => lovedSeed(myReviews), [myReviews]);
  const similar = useMemo(() => similarPlaces({ liked, pool, exclude: shownKeys }), [liked, pool, shownKeys]);
  const meal = useMemo(() => mealPicks({ pool, ratings }), [pool, ratings]);
  const interest = useMemo(() => {
    const p = nearbyInterest({ usual: usual.filter((u) => !shownKeys.includes(pickKey(u))) });
    return p ? { ...p, reason: `One of your favorite kinds of places, just around the corner.` } : null;
  }, [usual, shownKeys]);
  const mealNow = isMealTime(new Date(now));

  return (
    <div className="mpp">
      <div className="card section lab-controls">
        <div className="lab-controls-head">
          <strong>{'\u{1F5FA}\u{FE0F}'} Mapr Picks preview</strong>
          <span className="tag">Test only · logged with a test flag</span>
        </div>
        <PreviewAsSwitcher value={previewAs} onChange={setPreviewAs} />
        <SimulateLocation value={presetId} onChange={setPresetId} />
        <p className="screen-subtitle mpp-control-note">
          Your account: {ratingsCount} rating{ratingsCount === 1 ? '' : 's'}
          {ratingsCount < MIN_RATINGS_FOR_PICKS ? ` (under ${MIN_RATINGS_FOR_PICKS}, so every state shows as a new user)` : ''}
          {!coords && !preset ? ' · no real location yet, pick a city above' : ''}
        </p>
      </div>

      <PhoneFrame label="Map tab preview">
        <PreviewMap center={origin} landmarks={ALL_LANDMARKS} visitedIds={visitedIds} radiusMiles={miles} />
        <PicksBottomSheet
          state={state}
          picks={picks}
          updating={state === 'ready' && updating}
          slow={state === 'ready' && previewAs === 'slow'}
          expanded={expanded}
          onExpandedChange={setExpanded}
          showChainLabels
          toolbar={<DistanceFilter value={miles} onChange={setMiles} />}
        >
          <BecauseYouLikedRow liked={liked} places={similar} />
          <MoodCarousel pool={pool} ratings={ratings} />
          <MealCard places={meal} />
          <NearbyInterestCard place={interest} />
        </PicksBottomSheet>
      </PhoneFrame>

      <div className="card section mpp-debug">
        <strong>Preview details</strong>
        <p className="screen-subtitle">
          Meal card: {mealNow ? 'meal time now, so it shows' : 'shown here for testing; in the app it only shows around meal times'}.
          {cachedAt ? ` Last set cached ${new Date(cachedAt).toLocaleTimeString()}.` : ' No cached set for this spot yet.'}
        </p>
        <div className="field">
          <label htmlFor="mpp-last-cat">Pretend my last check-in was</label>
          <select
            id="mpp-last-cat"
            value={lastOverride === undefined ? '__history' : lastOverride ?? '__none'}
            onChange={(e) => {
              const v = e.target.value;
              setLastOverride(v === '__history' ? undefined : v === '__none' ? null : v);
            }}
          >
            <option value="__history">From my history ({historyLast ? categoryLabel(historyLast) : 'none'})</option>
            <option value="__none">No recent check-in</option>
            {INTERESTS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
        <p className="screen-subtitle">
          Links (back-to-back within {CHAIN_WINDOW_MS / 3600000}h on the same day, {CHAIN_MIN_COUNT}+ times, one way):
        </p>
        {links.length ? (
          <ul className="lab-log">
            {links.map((l) => (
              <li key={`${l.from}>${l.to}`}>
                {categoryLabel(l.from)} {'\u{2192}'} {categoryLabel(l.to)} ({l.count}
                {'\u{00D7}'})
              </li>
            ))}
          </ul>
        ) : (
          <p className="screen-subtitle">None yet from your check-ins.</p>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={state !== 'ready'}>
          {'\u{21BB}'} Clear cached picks and rebuild
        </button>
      </div>
    </div>
  );
}
