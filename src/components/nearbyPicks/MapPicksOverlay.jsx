import { TEST_MOODS } from '../../lib/nearbyPicks';
import { useMapPicks } from './useMapPicks';
import PicksBottomSheet from './PicksBottomSheet';
import DistanceFilter from './DistanceFilter';
import FoundByPeopleRow from './FoundByPeopleRow';
import BecauseYouLikedRow from './BecauseYouLikedRow';
import MoodCarousel from './MoodCarousel';
import MealCard from './MealCard';
import NearbyInterestCard from './NearbyInterestCard';
import ShakeUpCard from './ShakeUpCard';
import './nearbyPicks.css';

// "Picked for you right now" over the Map tab's live map: the top three
// picks when the Map opens, swipe up for the full list and the rows under
// it. Built from the signed-in account's own ratings, tag scores and
// check-ins, around the device's live location (coords from MapExplore's
// useGeo). Everything it shows is real: under 10 ratings it asks for more,
// with location off it asks for location, an old cached set shows with
// "Updating...", and offline the last set stays up.

export default function MapPicksOverlay({ topSlot = null, mapDistance = null, onMapDistance = null, distanceOptions = null, hidden = false, coords, geoError, overrides = null, customLandmarks = null, expanded, onExpandedChange, minimized, onMinimizedChange, peek = false, onPeekChange = null, showRefresh = false }) {
  const {
    uid,
    state,
    picks,
    updating,
    slow,
    distance,
    chooseDistance,
    beyond,
    ratingsCount,
    pool,
    ratings,
    rankRow,
    origin,
    online,
    showDifferent,
    refreshing,
    stagnating,
    found,
    liked,
    similar,
    meal,
    interest,
    onShown,
    onSimilarShown,
    onFoundShown,
    onMoodShown,
    onMealShown,
    onInterestShown,
  } = useMapPicks({ hidden, coords, geoError, overrides, customLandmarks, showRefresh, mapDistance, onMapDistance, distanceOptions });

  // MapExplore only mounts this signed in, once the account's own ratings
  // have loaded (so a new account isn't confused with one mid-load).
  if (!uid) return null;

  return (
    <div className="map-picks" hidden={hidden}>
      <PicksBottomSheet
        state={state}
        picks={picks}
        updating={updating}
        slow={slow}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        minimized={minimized}
        onMinimizedChange={onMinimizedChange}
        peek={peek}
        onPeekChange={onPeekChange}
        distanceMiles={distance}
        beyond={beyond}
        onWiden={chooseDistance}
        ratingsCount={ratingsCount}
        layout={showRefresh ? 'mood-first' : 'default'}
        topSlot={topSlot}
        moodSlot={showRefresh ? <MoodCarousel pool={pool} ratings={ratings} moods={TEST_MOODS} rank={rankRow} onShown={onMoodShown} /> : null}
        onRefresh={showRefresh && online ? showDifferent : null}
        refreshing={refreshing}
        onShown={onShown}
        uid={showRefresh ? null : uid}
        origin={origin}
        toolbar={<DistanceFilter value={distance} onChange={chooseDistance} {...(distanceOptions ? { options: distanceOptions } : {})} />}
      >
        {!showRefresh && <ShakeUpCard uid={uid} show={stagnating && online} onShake={showDifferent} />}
        <FoundByPeopleRow places={found} uid={uid} origin={origin} onShown={onFoundShown} />
        <BecauseYouLikedRow liked={liked} places={similar} uid={uid} origin={origin} onShown={onSimilarShown} />
        {!showRefresh && <MoodCarousel pool={pool} ratings={ratings} rank={rankRow} onShown={onMoodShown} />}
        {!showRefresh && <MealCard places={meal} onShown={onMealShown} />}
        {!showRefresh && <NearbyInterestCard place={interest} onShown={onInterestShown} />}
      </PicksBottomSheet>
    </div>
  );
}
