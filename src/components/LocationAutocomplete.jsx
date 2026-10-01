import { useEffect, useRef, useState } from 'react';
import { ALL_LANDMARKS, getRegion } from '../data/regions';
import { searchPlaces, getPlaceDetails, makeSessionToken } from '../lib/places';
import { matchesSearch } from '../lib/search';
import { friendlyError } from '../lib/friendlyError';
import { Skeleton } from './Skeleton';
import { useTrip } from '../lib/TripContext';
import { useFriends } from '../lib/FriendsContext';
import { nearestRegionId } from '../lib/geo';

const SEARCH_FAILED = "Couldn't search addresses right now. Landmarks still show above.";
const LOOKUP_FAILED = "Couldn't look up that address. Try again, or pick another result.";

export default function LocationAutocomplete({ id, name, value, regionId, onChange, onSelect, placeholder }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  // Bumped by "Try again" to re-run the same search without retyping.
  const [attempt, setAttempt] = useState(0);
  // A pick whose address lookup failed: "Try again" retries that lookup
  // instead of re-running the search.
  const [failedPick, setFailedPick] = useState(null);
  const boxRef = useRef(null);
  // One id per Autocomplete+Details "session" (Google's billing unit) --
  // reused across keystrokes, then replaced once a suggestion is resolved.
  const sessionTokenRef = useRef(makeSessionToken());

  useEffect(() => {
    function handleClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!value || value.trim().length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSearchError('');
    setFailedPick(null);
    const q = value.trim();
    // A slow earlier search must not overwrite the newer one's results (or
    // flip the spinner off) after the user has kept typing.
    let cancelled = false;
    const handle = setTimeout(async () => {
      const localMatches = ALL_LANDMARKS.filter((l) => matchesSearch([l.name, getRegion(l.regionId)?.name].join(' '), q))
        .sort((a, b) => (a.regionId === regionId ? -1 : 0) - (b.regionId === regionId ? -1 : 0))
        .slice(0, 4)
        .map((l) => ({
          key: `l-${l.id}`,
          primary: l.name,
          secondary: `${getRegion(l.regionId)?.name} landmark`,
          lat: l.lat,
          lng: l.lng,
          // Carried through to onSelect so a caller (Add Landmark) can tell
          // "picked an existing landmark by name" apart from "picked an
          // address" -- the former is a certain duplicate, not a maybe.
          landmarkId: l.id,
          landmarkRegionId: l.regionId,
        }));

      const region = regionId ? getRegion(regionId) : null;
      // A failed remote search (network error, Places API quota, a non-2xx
      // response) shouldn't look identical to "no matches" -- that makes a
      // real outage undiagnosable from a box that's just quietly empty.
      // Local landmark matches still show even if this fails. These
      // suggestions don't carry lat/lng yet -- resolveSuggestion() looks
      // that up via Place Details only once one is actually picked.
      let remoteMatches = [];
      try {
        const remote = await searchPlaces(value, region, sessionTokenRef.current);
        remoteMatches = remote
          .filter((r) => !localMatches.some((lm) => lm.primary.toLowerCase() === r.primary.toLowerCase()))
          .slice(0, 5)
          .map((r) => ({ key: `r-${r.placeId}`, ...r }));
      } catch (e) {
        if (cancelled) return;
        setSearchError(friendlyError(e, SEARCH_FAILED));
      }

      if (cancelled) return;
      setSuggestions([...localMatches, ...remoteMatches].slice(0, 7));
      setLoading(false);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [value, regionId, attempt]);

  // Local landmark matches already carry lat/lng; a Places suggestion only
  // has a placeId until now -- this is the one Place Details round trip per
  // pick, right when the user actually commits to a suggestion.
  const resolveSuggestion = async (s) => {
    if (!s.placeId) {
      onSelect(s);
      setOpen(false);
      return;
    }
    setSearchError('');
    setFailedPick(null);
    try {
      const details = await getPlaceDetails(s.placeId, sessionTokenRef.current);
      sessionTokenRef.current = makeSessionToken();
      onSelect({ primary: details.primary || s.primary, secondary: details.secondary || s.secondary, lat: details.lat, lng: details.lng });
      setOpen(false);
    } catch (e) {
      // What was typed stays in the box; the list stays open to try again.
      setSearchError(friendlyError(e, LOOKUP_FAILED));
      setFailedPick(s);
      setOpen(true);
    }
  };

  return (
    <div className="autocomplete" ref={boxRef}>
      {/* street-address lets the browser offer a saved address; the
          dropdown below still adds landmarks and hotels on top of that. */}
      <input
        id={id}
        name={name || id}
        type="text"
        autoComplete="street-address"
        enterKeyHint="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          // Typing a full address and pressing Enter (or tabbing/clicking
          // away) is how most people expect this to work -- clicking a
          // dropdown item was previously the only way the pin ever moved.
          if (e.key === 'Enter' && suggestions.length > 0) {
            e.preventDefault();
            resolveSuggestion(suggestions[0]);
          }
        }}
        onBlur={(e) => {
          // Tapping a suggestion blurs the input first -- without this check
          // the top suggestion also got resolved, racing the one actually
          // tapped (the pin could land on the wrong place). Also skip while
          // a search is in flight: the list is stale then.
          if (boxRef.current?.contains(e.relatedTarget) || loading) return;
          if (suggestions.length > 0) resolveSuggestion(suggestions[0]);
        }}
      />
      {open && (loading || suggestions.length > 0 || searchError) && (
        <div className="autocomplete-list">
          {loading && (
            <div className="autocomplete-skeleton" role="status">
              <span className="visually-hidden">Searching…</span>
              {[0, 1, 2].map((n) => (
                <div key={n} className="autocomplete-skeleton-item" aria-hidden="true">
                  <Skeleton width="55%" height={13} />
                  <Skeleton width="35%" height={10} />
                </div>
              ))}
            </div>
          )}
          {!loading && searchError && (
            <div className="autocomplete-loading autocomplete-error" role="alert">
              <span>{searchError}</span>
              <button
                type="button"
                className="btn btn-ghost btn-tight"
                // Keep focus in the box so its blur-to-pick doesn't fire.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (failedPick ? resolveSuggestion(failedPick) : setAttempt((a) => a + 1))}
              >
                {'\u{1F504}'} Try again
              </button>
            </div>
          )}
          {!loading &&
            suggestions.map((s) => (
              <button
                type="button"
                key={s.key}
                className="autocomplete-item"
                onClick={() => resolveSuggestion(s)}
              >
                <span className="autocomplete-primary">{s.primary}</span>
                {s.secondary && <span className="autocomplete-secondary">{s.secondary}</span>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// Drop next to a trip's starting-location box (TripSetup, Mapr's
// TripPlannerCard): when no start is set yet, fills in your saved home
// (Settings -> Home, users/{uid}.homeAddress/homeCoords) instead of leaving
// the box empty, and shows a small "Filled in from your saved home · Clear"
// line while it's in use. Never replaces anything already there, never
// switches you to a different city than the one you picked, and once you
// clear or change it (trip.homeStartSkipped) it stops coming back.
export function HomeStartPrefill() {
  const { trip, updateTrip } = useTrip();
  const { myProfile } = useFriends();
  const [prefilled, setPrefilled] = useState(false);
  const triedRef = useRef(false);
  const home = myProfile?.homeCoords;
  const homeLabel = myProfile?.homeAddress || 'Home';

  useEffect(() => {
    if (triedRef.current || !home) return;
    triedRef.current = true;
    if (trip.startingLocation || trip.startingCoords || trip.homeStartSkipped) return;
    const homeRegion = nearestRegionId(home.lat, home.lng);
    if (trip.activeRegion && homeRegion !== trip.activeRegion) return;
    updateTrip({
      startingLocation: homeLabel,
      startingCoords: { lat: home.lat, lng: home.lng },
      activeRegion: trip.activeRegion || homeRegion,
    });
    setPrefilled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home?.lat, home?.lng]);

  // Picking or typing anything else counts as "not home this time".
  useEffect(() => {
    if (prefilled && trip.startingLocation !== homeLabel) {
      setPrefilled(false);
      updateTrip({ homeStartSkipped: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.startingLocation]);

  if (!prefilled) return null;
  return (
    <p className="draft-restored-note">
      {'\u{1F3E0}'} Filled in from your saved home.
      <button
        type="button"
        onClick={() => {
          setPrefilled(false);
          updateTrip({ startingLocation: '', startingCoords: null, homeStartSkipped: true });
        }}
      >
        Clear
      </button>
    </p>
  );
}
