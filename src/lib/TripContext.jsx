import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { migrateInterests, getRegion, canonicalLandmarkId } from '../data/regions';

const STORAGE_KEY = 'landmarkhunters.trip.v1';

const DEFAULT_TRIP = {
  startingLocation: '',
  startingCoords: null,
  activeRegion: null, // city currently being browsed (Setup / Landmarks context)
  // True once you've picked a city on Landmarks yourself -- from then on GPS
  // no longer overrides activeRegion when you come back to that screen.
  activeRegionPicked: false,
  // Visited/Unvisited tab selection on Choose Landmarks -- persisted so it
  // survives navigating into a landmark's Info page and back (that screen
  // unmounts Choose Landmarks, which would otherwise reset local state).
  visitFilter: [],
  interests: [],
  customInterests: [],
  // { [customInterestText]: string[] of "regionId/landmarkId" } — which landmarks
  // the AI decided fit a free-text interest like "nightlife" or "racing", since
  // those don't map to any of the built-in categories on their own.
  customInterestMatches: {},
  // { [customInterestText]: emoji } -- one emoji the AI picked to represent
  // that free-text interest (e.g. "racing" -> a race car), chosen alongside
  // its landmark matches so the chip shows something more specific than a
  // generic sparkle.
  customInterestEmoji: {},
  // "My Preferences" on Profile -- your usual picks, saved once so Setup can
  // fill interests/customInterests in with one tap instead of re-choosing
  // them on every trip. Independent of the live trip.interests below.
  savedInterests: [],
  savedCustomInterests: [],
  // Custom preference chips you've turned off without deleting -- "Use My
  // Preferences" skips these, same as an unchecked built-in category, but
  // the chip stays put so you can turn it back on later.
  deselectedCustomInterests: [],
  byRegion: {}, // { [regionId]: string[] of landmark ids } — one itinerary per city
  // { [regionId]: string } -- a name you gave that city's itinerary
  // ("Villanova Visit Weekend"); falls back to the city's own name.
  itineraryNames: {},
  // { [regionId]: place[] } -- real places Mapr found on the web (not in the
  // catalog) that you added to that city's itinerary:
  // { id, name, address, lat, lng, url }
  placesByRegion: {},
  // { [regionId | `group:<id>`]: 'past' | 'current' } -- a manual "Move to
  // Past" / "Move back to Current" (see src/lib/itineraryStatus.js).
  itineraryStatus: {},
};

function loadTrip() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TRIP;
    const parsed = JSON.parse(raw);
    const t = { ...DEFAULT_TRIP, ...parsed };
    // Migrate the old single-city model (region + selectedLandmarkIds) → byRegion map.
    if (!parsed.byRegion) {
      t.byRegion = parsed.region && parsed.selectedLandmarkIds?.length
        ? { [parsed.region]: parsed.selectedLandmarkIds }
        : {};
      t.activeRegion = parsed.region ?? null;
    }
    t.byRegion = Object.fromEntries(
      Object.entries(t.byRegion || {}).map(([region, ids]) => [
        region,
        // Deduped: a list saved with both a renamed landmark's old id and its
        // new one would otherwise show that stop twice.
        Array.isArray(ids) ? [...new Set(ids.map((id) => canonicalLandmarkId(id, region)))] : ids,
      ])
    );
    t.itineraryNames = t.itineraryNames || {};
    t.placesByRegion = t.placesByRegion || {};
    t.itineraryStatus = t.itineraryStatus || {};
    // Retired interest ids (e.g. the old "food-local-life") become their
    // replacements, so a saved preference keeps filtering after a split.
    t.interests = migrateInterests(t.interests);
    t.savedInterests = migrateInterests(t.savedInterests);
    return t;
  } catch {
    return DEFAULT_TRIP;
  }
}

const TripContext = createContext(null);

export function TripProvider({ children }) {
  const [trip, setTrip] = useState(loadTrip);
  // Which city the Map should frame — set only when you actively view a city
  // this session (list / detail / itinerary). Deliberately NOT persisted, so a
  // fresh app launch falls back to your GPS location instead of the last city.
  const [mapFocus, setMapFocusRegion] = useState(null);
  // One-shot "fly to this exact landmark" request from a detail page — {lat,lng}.
  const [mapFocusPoint, setMapFocusPoint] = useState(null);
  // Every stop of the itinerary you're looking at ({lat,lng}[]), so opening
  // the Map from it frames all of them. Framing a plain city clears it.
  const [mapFocusStops, setMapFocusStops] = useState(null);
  const setMapFocus = useCallback((regionId) => {
    setMapFocusRegion(regionId);
    setMapFocusStops(null);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trip));
    } catch {
      /* private mode / storage full: the trip still works for this session */
    }
  }, [trip]);

  const updateTrip = (patch) => setTrip((t) => ({ ...t, ...patch }));

  // Records which landmarks the AI matched to a custom interest, once classified.
  const setCustomInterestMatches = (text, ids) =>
    setTrip((t) => ({ ...t, customInterestMatches: { ...t.customInterestMatches, [text]: ids } }));

  const setCustomInterestEmoji = (text, emoji) =>
    setTrip((t) => ({ ...t, customInterestEmoji: { ...t.customInterestEmoji, [text]: emoji } }));

  const removeCustomInterest = (text) =>
    setTrip((t) => {
      const customInterestMatches = { ...t.customInterestMatches };
      delete customInterestMatches[text];
      const customInterestEmoji = { ...t.customInterestEmoji };
      delete customInterestEmoji[text];
      return {
        ...t,
        customInterests: t.customInterests.filter((i) => i !== text),
        customInterestMatches,
        customInterestEmoji,
      };
    });

  // Add/remove a landmark within its own city's itinerary (never touches other cities).
  const toggleLandmark = (id, regionId) => {
    setTrip((t) => {
      const cur = t.byRegion[regionId] || [];
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      const byRegion = { ...t.byRegion };
      if (next.length) byRegion[regionId] = next;
      else delete byRegion[regionId];
      return { ...t, byRegion, activeRegion: regionId };
    });
  };

  // Replace a city's whole selection (used by "Suggest For Me" / "Clear").
  const setRegionSelection = (regionId, ids) => {
    setTrip((t) => {
      const byRegion = { ...t.byRegion };
      if (ids.length) byRegion[regionId] = ids;
      else delete byRegion[regionId];
      return { ...t, byRegion, activeRegion: regionId };
    });
  };

  // Hold-and-drag reorder (see useDragReorder.js) writes the whole new
  // order straight back to byRegion -- the array's own order IS the
  // itinerary's visit order for the 'custom' sort, so there's no separate
  // order field to keep in sync.
  const reorderLandmarks = (regionId, orderedIds) =>
    setTrip((t) => ({ ...t, byRegion: { ...t.byRegion, [regionId]: orderedIds } }));

  // Idempotent add (Mapr's "add it to my itinerary" shouldn't toggle a
  // stop OFF if it was already there).
  const addLandmark = (id, regionId) =>
    setTrip((t) => {
      const cur = t.byRegion[regionId] || [];
      if (cur.includes(id)) return t;
      return { ...t, byRegion: { ...t.byRegion, [regionId]: [...cur, id] }, activeRegion: regionId };
    });

  const removeLandmark = (id, regionId) =>
    setTrip((t) => {
      const next = (t.byRegion[regionId] || []).filter((x) => x !== id);
      const byRegion = { ...t.byRegion };
      if (next.length) byRegion[regionId] = next;
      else delete byRegion[regionId];
      return { ...t, byRegion };
    });

  const addPlace = (regionId, place) =>
    setTrip((t) => {
      const cur = t.placesByRegion[regionId] || [];
      if (cur.some((p) => p.id === place.id)) return t;
      return { ...t, placesByRegion: { ...t.placesByRegion, [regionId]: [...cur, place] }, activeRegion: regionId };
    });

  const removePlace = (regionId, id) =>
    setTrip((t) => {
      const next = (t.placesByRegion[regionId] || []).filter((p) => p.id !== id);
      const placesByRegion = { ...t.placesByRegion };
      if (next.length) placesByRegion[regionId] = next;
      else delete placesByRegion[regionId];
      // Edit List / drag also store a place's id in the saved order
      // (byRegion); drop it too so a deleted place can't linger there.
      const byRegion = { ...t.byRegion };
      const order = (byRegion[regionId] || []).filter((x) => x !== id);
      if (order.length) byRegion[regionId] = order;
      else delete byRegion[regionId];
      return { ...t, placesByRegion, byRegion };
    });

  const renameItinerary = (regionId, name) =>
    setTrip((t) => {
      const itineraryNames = { ...t.itineraryNames };
      const clean = String(name || '').trim().slice(0, 80);
      if (clean) itineraryNames[regionId] = clean;
      else delete itineraryNames[regionId];
      return { ...t, itineraryNames };
    });

  // Removes a city's itinerary entirely (stops, places and its name) --
  // used when it's turned into a group trip.
  const removeItinerary = (regionId) =>
    setTrip((t) => {
      const byRegion = { ...t.byRegion };
      const placesByRegion = { ...t.placesByRegion };
      const itineraryNames = { ...t.itineraryNames };
      const itineraryStatus = { ...t.itineraryStatus };
      delete byRegion[regionId];
      delete placesByRegion[regionId];
      delete itineraryNames[regionId];
      delete itineraryStatus[regionId];
      return { ...t, byRegion, placesByRegion, itineraryNames, itineraryStatus };
    });

  // 'past' | 'current' to move an itinerary by hand; null goes back to automatic.
  const setItineraryStatus = (key, status) =>
    setTrip((t) => {
      const itineraryStatus = { ...t.itineraryStatus };
      if (status) itineraryStatus[key] = status;
      else delete itineraryStatus[key];
      return { ...t, itineraryStatus };
    });

  const clearRegion = (regionId) =>
    setTrip((t) => {
      const byRegion = { ...t.byRegion };
      delete byRegion[regionId];
      return { ...t, byRegion };
    });

  const clearAll = () => setTrip((t) => ({ ...t, byRegion: {} }));

  const toggleSavedInterest = (id) =>
    setTrip((t) => ({
      ...t,
      savedInterests: t.savedInterests.includes(id) ? t.savedInterests.filter((i) => i !== id) : [...t.savedInterests, id],
    }));

  const addSavedCustomInterest = (text) =>
    setTrip((t) => (t.savedCustomInterests.includes(text) ? t : { ...t, savedCustomInterests: [...t.savedCustomInterests, text] }));

  const removeSavedCustomInterest = (text) =>
    setTrip((t) => ({
      ...t,
      savedCustomInterests: t.savedCustomInterests.filter((x) => x !== text),
      deselectedCustomInterests: t.deselectedCustomInterests.filter((x) => x !== text),
    }));

  // Turns a saved custom interest chip on/off without deleting it -- mirrors
  // toggleSavedInterest's on/off for the built-in categories.
  const toggleSavedCustomInterestSelected = (text) =>
    setTrip((t) => ({
      ...t,
      deselectedCustomInterests: t.deselectedCustomInterests.includes(text)
        ? t.deselectedCustomInterests.filter((x) => x !== text)
        : [...t.deselectedCustomInterests, text],
    }));

  // One tap on Setup: replace the live trip interests with your saved ones
  // (skipping any custom ones you've turned off).
  const applyPreferences = () =>
    setTrip((t) => ({
      ...t,
      interests: [...t.savedInterests],
      customInterests: t.savedCustomInterests.filter((x) => !t.deselectedCustomInterests.includes(x)),
    }));

  const getRegionSelection = (regionId) => trip.byRegion[regionId] || [];

  // A city counts once it has catalog stops, Mapr-found places, or a name
  // (a freshly created, still-empty itinerary).
  const regionsWithItineraries = () =>
    [...new Set([...Object.keys(trip.byRegion), ...Object.keys(trip.placesByRegion), ...Object.keys(trip.itineraryNames)])].filter(
      (r) => trip.byRegion[r]?.length || trip.placesByRegion[r]?.length || trip.itineraryNames[r]
    );

  const itineraryName = (regionId) => trip.itineraryNames[regionId] || getRegion(regionId)?.name || 'Itinerary';

  const resetTrip = () => setTrip(DEFAULT_TRIP);

  return (
    <TripContext.Provider
      value={{
        trip,
        updateTrip,
        toggleLandmark,
        addLandmark,
        removeLandmark,
        addPlace,
        removePlace,
        renameItinerary,
        removeItinerary,
        setItineraryStatus,
        itineraryName,
        setRegionSelection,
        reorderLandmarks,
        clearRegion,
        clearAll,
        getRegionSelection,
        regionsWithItineraries,
        resetTrip,
        setCustomInterestMatches,
        setCustomInterestEmoji,
        removeCustomInterest,
        toggleSavedInterest,
        addSavedCustomInterest,
        removeSavedCustomInterest,
        toggleSavedCustomInterestSelected,
        applyPreferences,
        mapFocus,
        setMapFocus,
        mapFocusPoint,
        setMapFocusPoint,
        mapFocusStops,
        setMapFocusStops,
      }}
    >
      {children}
    </TripContext.Provider>
  );
}

export function useTrip() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useTrip must be used inside TripProvider');
  return ctx;
}
