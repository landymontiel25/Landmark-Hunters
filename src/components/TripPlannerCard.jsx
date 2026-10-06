import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTrip } from '../lib/TripContext';
import { useAuth } from '../lib/AuthContext';
import { useRatings } from '../lib/RatingsContext';
import { useFriends } from '../lib/FriendsContext';
import { useGeo } from '../lib/GeoContext';
import { clearPersisted, usePersistentState } from '../lib/usePersistentState';
import { getLandmark, getRegion } from '../data/regions';
import { nearestRegionId } from '../lib/geo';
import { geocodeLocation } from '../lib/geocode';
import { useGpsStartLocation } from '../lib/useGpsStartLocation';
import { classifyInterest } from '../lib/interestClassifier';
import { pickRegion } from '../lib/tagScores';
import { ratePlacesText, visitedReviewIds } from '../lib/nearbyPicks';
import {
  MIN_RATINGS_FOR_PICK_TYPE,
  TRIP_STEPS,
  composePlanMessage,
  isPlanCacheValid,
  planAnswersKey,
  rankTripPicks,
  readPlanCache,
  writePlanCache,
} from '../lib/tripPlanner';
import { loadMaprModels } from '../lib/maprRank/modelStore.js';
import { readSeen } from '../lib/maprRank/seenHistory.js';
import { readLocalFeedback } from '../lib/pickFeedback';
import ChatWizard from './ChatWizard';
import LocationAutocomplete, { HomeStartPrefill } from './LocationAutocomplete';
import MultiRegionSearch from './MultiRegionSearch';

const MOODS = [
  { value: 'energized', icon: '\u{26A1}', label: 'Energized & Active', hint: 'upbeat, on your feet, go-go-go' },
  { value: 'easygoing', icon: '\u{1F634}', label: 'Easygoing & Chill', hint: 'relaxed, slower pace, low-key' },
];
const PICK_TYPES = [
  { value: 'usual', icon: '\u{2B50}', label: 'The usual', hint: 'more of what you already love' },
  { value: 'new', icon: '\u{1F9ED}', label: 'Something new', hint: "kinds of places you haven't tried much" },
];
const TRIP_MODES = [
  { value: 'solo', icon: '\u{1F464}', label: 'Solo' },
  { value: 'group', icon: '\u{1F465}', label: 'Group' },
];
// Asked on the last step, before every plan: who is this request for?
// Group plans follow the wish and never use the user's own taste.
const REQUEST_FOR_CHOICES = [
  { value: 'solo', icon: '\u{1F464}', label: 'Just me' },
  { value: 'group', icon: '\u{1F465}', label: 'A group' },
];
const LOCATION_CHOICES = [
  { value: 'gps', icon: '\u{1F4CD}', label: 'Use my current location' },
  { value: 'type', icon: '\u{2328}\u{FE0F}', label: 'Type an address' },
];

const DEFAULT_WIZARD = {
  step: 'location',
  locationMode: null, // null | 'gps' | 'type'
  needCity: false, // location off or address not found -> ask for a city
  mood: null,
  pickType: null, // null | 'usual' | 'new'
  specific: '',
  tripMode: null, // null | 'solo' | 'group'
};
const isDefault = (w) => !w || JSON.stringify({ ...DEFAULT_WIZARD, ...w }) === JSON.stringify(DEFAULT_WIZARD);


// Mapr's Plan Your Trip, as a step-by-step chat (ChatWizard): where you're
// starting, your mood, the usual vs. something new, solo or group, then one
// "Plan my trip" that turns every answer into a single chat message Mapr
// answers like any other -- the same message path (and group-trip
// handling) the old one-screen form used. Every question and button is
// fixed text: no AI runs while you tap through. Answers are saved as you
// go, so closing the app picks up on the same step.
//
// onPlan(message, { onReply }) sends a fresh plan; onPlan(message,
// { cachedReply }) replays the last plan when nothing has changed.
export default function TripPlannerCard({ regions, onSetRegions, onToggleRegion, onClearRegions, onClose, onPlan }) {
  const { trip, updateTrip } = useTrip();
  const { user } = useAuth();
  const { myReviews } = useRatings();
  const { myProfile } = useFriends();
  const { coords } = useGeo();
  const { useCurrentLocation: locateMe, locating, locateError, usingGps } = useGpsStartLocation();
  const navigate = useNavigate();
  const storageKey = `mapr.wizard.${user?.uid || 'anon'}`;
  const [saved, setWizard] = usePersistentState(storageKey, DEFAULT_WIZARD, { isEmpty: isDefault });
  const wizard = { ...DEFAULT_WIZARD, ...saved };
  const set = (patch) => setWizard((cur) => ({ ...DEFAULT_WIZARD, ...cur, ...patch }));
  const [addressMissing, setAddressMissing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [planning, setPlanning] = useState(false);
  // On the last step, after "Plan my trip": asking "Just me" or "A group".
  const [asking, setAsking] = useState(false);
  const gpsPending = useRef(false);

  const ratingsCount = Object.values(myReviews || {}).filter((r) => r?.ratingTier).length;
  const canPickType = ratingsCount >= MIN_RATINGS_FOR_PICK_TYPE;
  const pickTypeChosen = canPickType ? wizard.pickType : null;
  const pickType = pickTypeChosen;

  const index = Math.max(0, TRIP_STEPS.indexOf(wizard.step));
  const goTo = (step) => {
    setAsking(false);
    set({ step });
  };
  const advance = () => goTo(TRIP_STEPS[Math.min(index + 1, TRIP_STEPS.length - 1)]);
  const back = () => goTo(TRIP_STEPS[Math.max(index - 1, 0)]);

  // The plan's city comes from where you're starting; only ask for one when
  // location is off or the address couldn't be found.
  const fillRegionFrom = (point) => {
    const region = getRegion(nearestRegionId(point.lat, point.lng));
    if (region && !(regions.length === 1 && regions[0].id === region.id)) onSetRegions?.([region]);
  };

  // "Use my current location" moves on by itself once the fix lands.
  useEffect(() => {
    if (!gpsPending.current || wizard.step !== 'location') return;
    if (usingGps && trip.startingCoords) {
      gpsPending.current = false;
      fillRegionFrom(trip.startingCoords);
      set({ step: 'mood', needCity: false });
    } else if (locateError && !locating) {
      gpsPending.current = false;
      set({ needCity: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingGps, trip.startingCoords, locateError, locating, wizard.step]);

  const chooseLocation = (mode) => {
    setAddressMissing(false);
    set({ locationMode: mode, needCity: false });
    if (mode === 'gps') {
      gpsPending.current = true;
      locateMe();
    }
  };

  const nextFromLocation = async () => {
    if (wizard.needCity) {
      if (regions.length) advance();
      return;
    }
    if (trip.startingCoords) {
      fillRegionFrom(trip.startingCoords);
      advance();
      return;
    }
    const text = (trip.startingLocation || '').trim();
    if (!text) return;
    setChecking(true);
    const found = await geocodeLocation(text);
    setChecking(false);
    if (found) {
      updateTrip({ startingCoords: found, activeRegion: nearestRegionId(found.lat, found.lng) });
      fillRegionFrom(found);
      advance();
    } else {
      setAddressMissing(true);
      set({ needCity: true });
    }
  };

  const skip = () => {
    if (wizard.step === 'mood') set({ mood: null });
    if (wizard.step === 'pick') set({ pickType: null, specific: '' });
    if (wizard.step === 'tripType') set({ tripMode: null });
    advance();
  };

  const onChoose = (value) => {
    if (wizard.step === 'location') chooseLocation(value);
    else if (wizard.step === 'mood') set({ mood: value, step: 'pick' });
    else if (wizard.step === 'pick') set({ pickType: wizard.pickType === value ? null : value });
    else if (wizard.step === 'tripType') set({ tripMode: value, step: 'plan' });
    else if (wizard.step === 'plan' && asking) planTrip(value);
  };

  const onNext = () => (wizard.step === 'location' ? nextFromLocation() : advance());

  const reset = () => {
    setWizard(DEFAULT_WIZARD);
    // The debounced save won't run once the card closes, so drop it now.
    clearPersisted(storageKey);
  };

  const planTrip = async (requestFor = 'solo') => {
    if (planning) return;
    setAsking(false);
    // A group plan never uses "The usual" / "Something new": those rank by the
    // user's own taste.
    const pickType = requestFor === 'group' ? null : pickTypeChosen;
    const regionIds = regions.map((r) => r.id);
    const origin = coords || trip.startingCoords || null;
    const answersKey = planAnswersKey({
      requestFor,
      mood: wizard.mood,
      pickType,
      specific: wizard.specific,
      tripMode: wizard.tripMode,
      startingLocation: trip.startingLocation,
      regionIds,
    });
    const cached = readPlanCache(user?.uid);
    if (isPlanCacheValid(cached, { answersKey, origin })) {
      reset();
      // logMeta: how Mapr's tab logs these picks once their cards are on screen.
      onPlan(cached.message, { cachedReply: cached.reply, requestFor, logMeta: { source: 'trip-planner', pickType: cached.pickType ?? pickType, rankedIds: [] } });
      return;
    }

    setPlanning(true);
    // The one optional extra AI call: only when something was typed.
    const specific = wizard.specific.trim();
    let matchIds = [];
    if (specific) {
      const { matches } = await classifyInterest(specific);
      matchIds = regionIds.length ? matches.filter((m) => regionIds.includes(m.split('/')[0])) : matches;
    }
    // "The usual" / "Something new": on-device ranking from saved tag scores.
    const rankRegions = regionIds.length
      ? regionIds
      : [trip.activeRegion || pickRegion({ origin, fallbackRegions: [] })].filter(Boolean);
    // Mapr Phase 1 models for these cities (null on failure: ranking still works).
    const models = pickType && user?.uid ? await loadMaprModels({ uid: user.uid, regions: rankRegions }).catch(() => null) : null;
    const ranked = rankTripPicks({
      pickType,
      profile: myProfile,
      regionIds: rankRegions,
      // Rated-and-visited places only: a place rated without a visit is still
      // somewhere new to go.
      excludeIds: visitedReviewIds(myReviews, myProfile),
      uid: user?.uid || null,
      origin,
      myReviews,
      models,
      explore: user?.uid ? { createdAtMs: myProfile?.createdAt?.seconds != null ? myProfile.createdAt.seconds * 1000 : null, shown: readSeen(user.uid), votes: readLocalFeedback(user.uid), serverStagnating: models?.serverStagnating === true } : null,
    });
    const message = composePlanMessage({
      mood: wizard.mood,
      tripMode: wizard.tripMode,
      startingLocation: trip.startingLocation,
      regionNames: regions.map((r) => r.name),
      pickType,
      rankedNames: ranked.map((l) => l.name),
      specific,
      specificMatchNames: matchIds.map((id) => getLandmark(...id.split('/'))?.name).filter(Boolean),
    });
    const rankedIds = ranked.map((l) => `${l.regionId}/${l.id}`);
    const uid = user?.uid;
    setPlanning(false);
    reset();
    onPlan(message, {
      requestFor,
      onReply: (reply) => {
        writePlanCache(uid, { answersKey, origin, message, reply, pickType });
        // Not logged here: a pick is logged when its card is on screen (Mapr.jsx).
        return { source: 'trip-planner', pickType, rankedIds };
      },
    });
  };

  const locationStatus =
    wizard.locationMode === 'gps' && locating
      ? 'Finding you\u{2026}'
      : addressMissing
        ? "Couldn't find that address."
        : wizard.needCity && locateError
          ? locateError
          : null;

  const cityPicker = wizard.needCity && (
    <div className="field chat-wizard-field">
      <label>Which city are you exploring?</label>
      <MultiRegionSearch selectedIds={regions.map((r) => r.id)} onToggle={onToggleRegion} onClearAll={onClearRegions} placeholder="Add a city…" />
    </div>
  );

  const summary = [
    trip.startingLocation && `\u{1F4CD} ${trip.startingLocation}`,
    regions.length > 0 && `\u{1F3D9}\u{FE0F} ${regions.map((r) => r.name).join(', ')}`,
    wizard.mood && `${MOODS.find((m) => m.value === wizard.mood)?.icon} ${MOODS.find((m) => m.value === wizard.mood)?.label}`,
    pickType && `${PICK_TYPES.find((p) => p.value === pickType)?.icon} ${PICK_TYPES.find((p) => p.value === pickType)?.label}`,
    wizard.specific.trim() && `\u{1F4AC} ${wizard.specific.trim()}`,
    wizard.tripMode && `${TRIP_MODES.find((t) => t.value === wizard.tripMode)?.icon} ${TRIP_MODES.find((t) => t.value === wizard.tripMode)?.label}`,
  ].filter(Boolean);

  const steps = [
    {
      id: 'location',
      question: 'Where are you starting from?',
      subtitle: trip.startingLocation && !wizard.locationMode ? `Right now: ${trip.startingLocation}` : null,
      choices: LOCATION_CHOICES,
      value: wizard.locationMode,
      skippable: false,
      status: locationStatus,
      statusError: !!(addressMissing || (wizard.needCity && locateError)),
      children: (
        <>
          {wizard.locationMode === 'type' && !wizard.needCity && (
            <div className="field chat-wizard-field">
              <LocationAutocomplete
                name="start-location"
                id="planner-start"
                placeholder="Address, hotel, etc."
                value={trip.startingLocation}
                onChange={(text) => {
                  setAddressMissing(false);
                  updateTrip({ startingLocation: text, startingCoords: null });
                }}
                onSelect={(s) =>
                  updateTrip({
                    startingLocation: s.primary,
                    startingCoords: { lat: s.lat, lng: s.lng },
                    activeRegion: nearestRegionId(s.lat, s.lng),
                  })
                }
              />
              <HomeStartPrefill />
            </div>
          )}
          {cityPicker}
        </>
      ),
      next:
        wizard.locationMode === 'type' || wizard.needCity || (!wizard.locationMode && trip.startingLocation)
          ? {
              disabled: checking || (wizard.needCity ? regions.length === 0 : !(trip.startingLocation || '').trim()),
              label: checking ? 'Checking\u{2026}' : 'Next',
            }
          : null,
    },
    {
      id: 'mood',
      question: 'What are you in the mood for?',
      choices: MOODS,
      value: wizard.mood,
    },
    {
      id: 'pick',
      question: 'What sounds good?',
      subtitle: canPickType ? null : `${ratePlacesText(ratingsCount, MIN_RATINGS_FOR_PICK_TYPE)} to unlock "The usual" and "Something new".`,
      choices: canPickType ? PICK_TYPES : null,
      value: pickType,
      children: (
        <div className="field chat-wizard-field">
          <label htmlFor="planner-specific">
            Anything specific? <span className="chat-wizard-optional">(optional)</span>
          </label>
          <input
            id="planner-specific"
            name="planner-specific"
            type="text"
            maxLength={200}
            placeholder="e.g. rooftop views, live jazz, tacos"
            value={wizard.specific}
            onChange={(e) => set({ specific: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                advance();
              }
            }}
          />
        </div>
      ),
      next: {},
    },
    {
      id: 'tripType',
      question: 'Is this trip just you, or a group?',
      choices: TRIP_MODES,
      value: wizard.tripMode,
    },
    {
      id: 'plan',
      question: asking ? 'Who is this plan for?' : "All set. Here's what I've got:",
      skippable: false,
      choices: asking ? REQUEST_FOR_CHOICES.map((c) => ({ ...c, disabled: planning })) : null,
      value: null,
      children: summary.length > 0 && (
        <ul className="chat-wizard-summary">
          {summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ),
      status: planning ? 'Planning\u{2026}' : null,
      // The request type is asked first, every time: "Plan my trip" opens it.
      primary: asking ? undefined : { label: '\u{2728} Plan my trip', onClick: () => setAsking(true), disabled: planning },
    },
  ];

  return (
    <ChatWizard
      className="trip-planner-card"
      title={'\u{1F9ED} Plan Your Trip'}
      steps={steps}
      index={index}
      onChoose={onChoose}
      onNext={onNext}
      onBack={back}
      onSkip={skip}
      onClose={onClose}
      footer={
        <button type="button" className="chat-wizard-link" onClick={() => navigate('/')}>
          {'\u{1F310}'} Just browse the map
        </button>
      }
    />
  );
}
