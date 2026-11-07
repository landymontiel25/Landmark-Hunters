import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePageRatings, ratingKey } from '../lib/usePageRatings';
import { useTopRatings } from '../lib/useTopRatings';
import { SkeletonList } from '../components/Skeleton';
import { RATINGS_FLAGS } from '../lib/ratingSources';
import { topLandmarksOrder, isRestaurantOrMall } from '../lib/topRated';
import { isMallPlace } from '../lib/malls';
import { LANDMARKS_SORT_KEY, TOP_LANDMARKS_SORT } from '../lib/landmarksSort';
import { isCommunityFind } from '../lib/communityLabels';
import { sportIconFor } from '../lib/landmarkVisuals';
import { useNavigate, useNavigationType } from 'react-router-dom';
import { restoreScroll, saveListReturn, takeListReturn } from '../lib/listReturn';
import { useTrip } from '../lib/TripContext';
import { useGeo } from '../lib/GeoContext';
import { useCheckIn } from '../lib/useCheckIn';
import { useRatings } from '../lib/RatingsContext';
import { useMyPhotos } from '../lib/MyPhotosContext';
import { useFriends } from '../lib/FriendsContext';
import { loadMaprModels } from '../lib/maprRank/modelStore.js';
import { rankPlaces } from '../lib/maprRank/surfaces.js';
import { kindBoost, tasteKindAffinity } from '../lib/placeKinds.js';
import { regionsWithin } from '../lib/nearbyPicks';
import { effectiveTagScores } from '../lib/tagScores';
import { distanceMeters } from '../lib/geo';
import { getMapView, nearestPickableCity, setMapView } from '../lib/nearestCity';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import DirectionsButton from '../components/DirectionsButton';
import ShareLandmarkButton from '../components/ShareLandmarkButton';
import SaveLandmarkButton from '../components/SaveLandmarkButton';
import AdmissionTag from '../components/AdmissionTag';
import { classifyInterest } from '../lib/interestClassifier';
import CheckInButton from '../components/CheckInButton';
import LandmarkThumb from '../components/LandmarkThumb';
import RatingsCardLine from '../components/ratings/RatingsCardLine';
import Lightbox from '../components/Lightbox';
import QuickRateButton from '../components/QuickRateButton';
import { ALL_LANDMARKS, INTERESTS, PICKABLE_INTERESTS, getRegion, getLandmark } from '../data/regions';
import { inArea, inScope, scopeFromKey, scopeRegionId, scopeRows } from '../lib/cityScope';
import { getCustomLandmarks } from '../lib/customLandmarks';
import { usePlacePacksVersion } from '../lib/placePacks';
import { useLandmarkEdits } from '../lib/LandmarkEditsContext';
import { matchesSearch, searchScore } from '../lib/search';
import { useSmartSearch, useSmartCitySearch, landmarkSearchText } from '../lib/smartSearch';
import SmartSearchLabel from '../components/SmartSearchLabel';
import { usePersistentState, useSessionState } from '../lib/usePersistentState';
import ErrorNotice from '../components/ErrorNotice';
import Neighborhoods from './Neighborhoods';
import './Neighborhoods.css';
import './LandmarkCards.css';

// A null sort (every sort tab toggled off) is a real choice worth keeping.
const NEVER_EMPTY = () => false;
// Search/filter choices are handy for a while, not forever -- after a day
// the list opens fresh instead of mysteriously pre-filtered.
const DAY = 24 * 60 * 60 * 1000;

// Marks where AI-understood matches start in the landmark list.
const SMART_DIVIDER = { id: '__smart__' };
const MORE_TAB = { id: '__restaurants-malls__' };

const CATEGORY_ICON = Object.fromEntries(INTERESTS.map((i) => [i.id, i.icon]));


// "For Me" moved to the Test tab's Planner launch bubble (owner,
// 2026-11-06); flip this to bring the button back here. The Test tab shows
// the same list with For Me locked on (LandmarkSelection forMeLab).
export const SHOW_FOR_ME_SORT = false;

// Top Landmarks (the old Top Rated) leads and is the default.
const ALL_SORT_OPTIONS = [
  { id: 'rated', label: '\u{2B50} Top Landmarks' },
  { id: 'forMe', label: '\u{2728} For Me' },
  { id: 'nearMe', label: '\u{1F4CD} Near Me' },
];
const SORT_OPTIONS = ALL_SORT_OPTIONS.filter((s) => s.id !== 'forMe' || SHOW_FOR_ME_SORT);
const FOR_ME_ONLY = ALL_SORT_OPTIONS.filter((s) => s.id === 'forMe');

// The "Add a Landmark" button under the search box is hidden for now (owner,
// 2026-10-27); flip this to bring it back.
const SHOW_ADD_LANDMARK = false;
// Cards sit two to a row with the photo on top (owner, 2026-11-06); CSS
// stretches the photo to the card's width (LandmarkCards.css).
const ROW_THUMB = 180;


// "For Me": how likely you are to actually go -- the same learned per-city
// category scores Mapr Picks ranks by (-100..100, from your ratings, with
// other cities lending a warm start), plus a nudge for the interests you
// picked at signup, plus the kind of place (placeKinds.js): a kind you
// swiped left on in onboarding or rated down sinks even inside a category
// you like. Ties fall through to Popular.
const INTEREST_BONUS = 15;
function forMeScore(l, profile, interests, scoresByRegion, affinity = null) {
  const region = l.regionId ?? null;
  if (!scoresByRegion.has(region)) scoresByRegion.set(region, effectiveTagScores(profile, region));
  const scores = scoresByRegion.get(region);
  const cats = l.categories || [];
  const tagPart = cats.length ? Math.max(...cats.map((c) => scores[c] || 0)) : 0;
  const interestPart = cats.some((c) => interests.has(c)) ? INTEREST_BONUS : 0;
  return tagPart + interestPart + (affinity ? kindBoost(l, affinity) : 0);
}

// "Popular": the catalog's popularity (0-10) nudged by community ratings,
// weighted by how many there are so one 5-star review can't jump the list.
// Curated Top 10 picks still lead, in rank order.
const popularScore = (l, ratings) => {
  const r = ratings[l.id];
  const community = r?.count ? (r.avg - 3) * 2 * (r.count / (r.count + 3)) : 0;
  return (l.popularity ?? 0) + community;
};

// Searchable city picker -- a plain multi-city tab row gets unwieldy once
// there are more than a handful of regions, so this collapses to one control
// with a filterable list instead of an ever-growing row of buttons.
// The city picker: states (US) and countries, and, as you type, every
// state, country, city and town that matches (lib/cityScope.js). `value` and
// onChange's argument are scope keys ('all', 'g:us-California',
// 'r:san-francisco', 'a:miami:Miami').
function CityDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const term = search.trim();
  const rows = scopeRows(term);
  // Mapr only steps in when no state, country, city or town matches.
  const smart = useSmartCitySearch(term, rows.filter((r) => r.key.startsWith('r:')).map((r) => ({ id: r.key.slice(2) })), open && rows.length === 0);
  const selectedLabel = scopeFromKey(value).label;

  const choose = (key) => {
    onChange(key);
    setOpen(false);
    setSearch('');
  };

  const row = (r) => (
    <button
      key={r.key}
      type="button"
      className={`city-dropdown-item autocomplete-item ${value === r.key ? 'active' : ''}`}
      onClick={() => choose(r.key)}
    >
      <span className="autocomplete-primary">{r.primary}</span>
      {r.secondary && <span className="autocomplete-secondary">{r.secondary}</span>}
    </button>
  );

  return (
    <div className="city-dropdown" ref={boxRef}>
      <button type="button" className="city-dropdown-toggle" onClick={() => setOpen((o) => !o)}>
        <span>{'\u{1F3D9}\u{FE0F}'} {selectedLabel}</span>
        <span className="city-dropdown-caret">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="city-dropdown-panel">
          <input
            type="search"
            name="city-search"
            aria-label="Search cities"
            autoComplete="off"
            enterKeyHint="search"
            placeholder={'\u{1F50D} Search states, countries, cities…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && term && rows.length) {
                e.preventDefault();
                choose(rows[0].key);
              }
            }}
            autoFocus
          />
          <div className="city-dropdown-list">
            {rows.map(row)}
            <SmartSearchLabel loading={smart.loading} count={smart.cities.length} />
            {smart.cities.map((r) => row({ key: `r:${r.id}`, primary: r.city, secondary: [r.state, r.country].filter(Boolean).join(', ') }))}
            {rows.length === 0 && !smart.loading && smart.cities.length === 0 && <p className="city-dropdown-empty">No cities match.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// The list shows PAGE_SIZE landmarks at a time with Previous / Next under it
// (owner, 2026-11-05). Each page's Google ratings load up front, and the next
// page's load behind them, so a page is ready when you get to it
// (src/lib/usePageRatings.js).
const PAGE_SIZE = 25;

// One row of the landmark list. Memoized: with ~870 rows, re-rendering all of
// them on every keystroke elsewhere, selection tick or GPS update froze phones.
const LandmarkRow = memo(function LandmarkRow({
  l,
  isSelected,
  photo,
  ratingAvg,
  ratingCount,
  distanceText,
  user,
  firebaseEnabled,
  claimedMap,
  checkingIn,
  onToggle,
  onCheckIn,
  onOpenPhoto,
  onInfo,
  ratingSources,
}) {
  // The app's own average (Landmark Hunters users) sits on the photo as the
  // score badge; the Google line below still falls back to "No ratings yet".
  const hasAppRating = ratingCount > 0;
  const toggle = () => onToggle(l);
  const thumb = <LandmarkThumb landmark={l} myPhoto={photo} size={ROW_THUMB} />;
  return (
    <div className={`landmark-row lm-card ${isSelected ? 'selected' : ''} ${claimedMap[l.id] ? 'visited' : ''}`}>
      <div className="lm-card-photo">
        {photo || l.images?.[0] ? (
          <button
            type="button"
            className="lr-thumb-btn"
            onClick={() => onOpenPhoto({ src: photo || l.images[0], alt: l.name })}
            aria-label={`View photo of ${l.name}`}
          >
            {thumb}
          </button>
        ) : (
          <div onClick={toggle}>{thumb}</div>
        )}
        <div
          className="check-circle lm-card-check"
          role="checkbox"
          aria-checked={isSelected}
          aria-label={`${isSelected ? 'Remove' : 'Add'} ${l.name} ${isSelected ? 'from' : 'to'} itinerary`}
          tabIndex={0}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
        >
          {isSelected ? '✓' : ''}
        </div>
        {hasAppRating && (
          <span className="nb-score-badge lm-card-badge band-none" title="Landmark Hunters rating">
            {'⭐'} {ratingAvg.toFixed(1)} ({ratingCount})
          </span>
        )}
        <div className="lr-corner lm-card-corner">
          <SaveLandmarkButton landmark={l} regionId={l.regionId} />
          <ShareLandmarkButton icon landmark={l} regionId={l.regionId} />
        </div>
      </div>
      <div className="lr-main" onClick={toggle}>
        <h4>
          <span className="lr-category-icons">{l.categories.map((c) => ((c === 'sports' || c === 'stadiums') && sportIconFor(l)) || CATEGORY_ICON[c]).join('')}</span>
          {l.name}
          <QuickRateButton landmark={l} />
        </h4>
        <div className="lr-meta">
          <AdmissionTag landmark={l} short />
          {/* The Google rating (⭐ 4.6 (1,234) Google Maps); with no Google
              rating the app's own average is the badge on the photo. Signed
              out the endpoint answers nothing, so the card skips the call. */}
          {user && <RatingsCardLine landmark={l} fallback={null} preloaded={ratingSources} />}
          {distanceText && <span className="tag distance-tag">{'\u{1F4CD}'} {distanceText} away</span>}
        </div>
      </div>
      <div className="lr-actions">
        <button type="button" className="btn btn-ghost btn-tight" onClick={() => onInfo(l)}>
          Info
        </button>
        <DirectionsButton name={l.name} lat={l.lat} lng={l.lng} className="btn btn-ghost btn-tight" />
        <CheckInButton
          landmark={l}
          user={user}
          firebaseEnabled={firebaseEnabled}
          claimedMap={claimedMap}
          checkingIn={checkingIn}
          onCheckIn={onCheckIn}
          className="btn-tight"
        />
      </div>
    </div>
  );
});

// forMeLab: the Test tab's copy (Planner launch), the same list locked on
// For Me, with no subtabs.
export default function LandmarkSelection({ forMeLab = false } = {}) {
  const {
    trip,
    toggleLandmark,
    getRegionSelection,
    regionsWithItineraries,
    clearRegion,
    clearAll,
    updateTrip,
    setMapFocus,
    setCustomInterestMatches,
    setCustomInterestEmoji,
  } = useTrip();
  const { coords } = useGeo();
  const { units } = useUnits();
  const { user, firebaseEnabled, claimedMap, checkingIn, checkIn } = useCheckIn();
  const { applyEdit } = useLandmarkEdits();
  const { myPhotos } = useMyPhotos();
  const { ratings, myReviews } = useRatings();
  const { myProfile } = useFriends();
  const navigate = useNavigate();
  // Back from a landmark's page lands on the rows you were looking at, in
  // the city you had picked, not the top of the list. Only on Back (POP).
  const navType = useNavigationType();
  const [returned] = useState(() => {
    if (forMeLab) return null;
    const saved = takeListReturn('landmarks');
    return navType === 'POP' ? saved : null;
  });

  // User-submitted landmarks (via "Add a Landmark") -- merged in below so
  // they're searchable/browsable here too, not just visible on the map.
  const [customLandmarks, setCustomLandmarks] = useState([]);
  // The built-in catalog shows regardless; this only covers the
  // community-added extras, so a failure is a small notice, not a blank list.
  const [customError, setCustomError] = useState(null);
  const loadCustomLandmarks = useCallback(() => {
    setCustomError(null);
    getCustomLandmarks().then(setCustomLandmarks).catch(setCustomError);
  }, []);
  useEffect(() => {
    loadCustomLandmarks();
  }, [loadCustomLandmarks]);
  // Opens on the city you are in (GPS, within 30 miles), and Back from a
  // landmark returns to it too; every landmark when there is no fix or no
  // city nearby. It never starts from trip.activeRegion: that is saved per
  // device and never expires, so a city browsed once (e.g. San Francisco)
  // came back on every later visit. Pick a city from the dropdown to
  // change it for this visit.
  // Where the Map tab was looking (city scale) wins over where you are. Back
  // from a landmark keeps the list you left, so the saved scroll spot lands
  // on the same rows.
  const [mapCity] = useState(() => nearestPickableCity(getMapView(), 50));
  // "All cities" is kept on Back only when it was picked by hand; as a mere
  // default it yields to the Map's city like a fresh open (#598).
  // Where the list is limited to (lib/cityScope.js): everywhere, a state or
  // country, one city, or one town in it. Its regionIds (null: everywhere)
  // are what the itinerary, Clear and Mapr's models work with.
  const [scopeKey, setScopeKey] = useState(() =>
    scopeFromKey(returned?.city && (returned.city !== 'all' || returned.picked) ? returned.city : mapCity || 'all').key
  );
  const scope = useMemo(() => scopeFromKey(scopeKey), [scopeKey]);
  // An area drawn on the Map (its + dial's pencil) limits this list too,
  // until it is cleared here or on the Map.
  const [drawnArea, setDrawnArea] = useSessionState('map.drawnArea', null);
  const drawnShape = useMemo(() => (drawnArea?.length > 2 ? { area: [drawnArea] } : null), [drawnArea]);
  const setCityFilter = (id) => setScopeKey(scopeFromKey(id).key);
  // Back from a landmark keeps a hand-picked city hand-picked.
  const cityPickedByHand = useRef(!!returned?.picked);
  const gpsLat = coords?.lat ?? null;
  const gpsLng = coords?.lng ?? null;
  const gpsCity = useMemo(
    () => nearestPickableCity(gpsLat != null && gpsLng != null ? { lat: gpsLat, lng: gpsLng } : null, 30),
    [gpsLat, gpsLng]
  );
  // No map view and no pick yet: open on the city you are in once GPS answers.
  useEffect(() => {
    if (cityPickedByHand.current || mapCity || (returned?.city && (returned.city !== 'all' || returned.picked)) || !gpsCity) return;
    setCityFilter(gpsCity);
  }, [gpsCity, mapCity, returned]);
  // Mapr Phase 1 models for "For Me" (maprRank/surfaces.js): the chosen city,
  // or the cities within 30 miles of you. Null until loaded.
  const modelRegions = useMemo(
    () => (scope.regionIds ? [...scope.regionIds].sort().join(',') : coords ? regionsWithin({ lat: coords.lat, lng: coords.lng }, 30).sort().join(',') : ''),
    [scope, coords?.lat != null ? Math.round(coords.lat * 10) : null, coords?.lng != null ? Math.round(coords.lng * 10) : null] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [maprModels, setMaprModels] = useState(null);
  useEffect(() => {
    if (!user?.uid || !modelRegions) return undefined;
    let cancelled = false;
    loadMaprModels({ uid: user.uid, regions: modelRegions.split(',') })
      .then((m) => !cancelled && setMaprModels(m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.uid, modelRegions]);
  // Default to every interest picked on Setup -- built-in categories AND custom
  // ones you typed in -- so "Choose Landmarks" opens already narrowed to what you
  // said you wanted instead of dumping every landmark on you. Empty selection (no
  // interests chosen, or "All" tapped) means show everything.
  // Starts on every category; tapping category buttons narrows it (several
  // at once is fine, none means all).
  // Category lasts while the app is open and resets every launch; search
  // text and sort survive closing the app (see usePersistentState).
  const [activeCategories, setActiveCategories] = useSessionState('landmarks.category', []);
  // "Found by people" (Phase 3): only places someone like you (a taste
  // neighbor, someone you follow, a friend) shared a tip on. The chip shows
  // only when there are some.
  const [foundOnly, setFoundOnly] = useSessionState('landmarks.found', false);
  const isFound = useCallback((l) => isCommunityFind(l, maprModels?.community), [maprModels]);
  const hasFound = useMemo(() => Object.values(maprModels?.community || {}).some((r) => Object.values(r?.places || {}).some((c) => c?.likeYou)), [maprModels]);
  // A restored custom interest (or a retired category) may be gone since --
  // don't leave the list filtered by a button that no longer shows.
  useEffect(() => {
    const kept = activeCategories.filter((key) => PICKABLE_INTERESTS.some((i) => i.id === key) || trip.customInterests.includes(key));
    if (kept.length !== activeCategories.length) setActiveCategories(kept);
  }, [activeCategories, trip.customInterests, setActiveCategories]);
  const toggleCategory = (key) =>
    setActiveCategories((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  // Tapping a row's thumbnail opens the photo full-screen.
  const [lightbox, setLightbox] = useState(null);
  const [search, setSearch] = usePersistentState('landmarks.search', '', { ttlMs: DAY });
  // Top Landmarks is the default (see landmarksSort.js for the key).
  const [savedSort, setSortBy] = usePersistentState(LANDMARKS_SORT_KEY, TOP_LANDMARKS_SORT, { isEmpty: NEVER_EMPTY });
  // Up arrow: not-checked-in first. Down arrow: checked-in first. null: neither.
  const [savedCheckInOrder, setCheckInOrder] = usePersistentState('landmarks.checkInOrder', null, { isEmpty: NEVER_EMPTY });
  const checkInOrder = savedCheckInOrder === 'up' || savedCheckInOrder === 'down' ? savedCheckInOrder : null;
  const sortBy = forMeLab ? 'forMe' : savedSort === 'nearMe' ? 'nearMe' : savedSort === 'forMe' && SHOW_FOR_ME_SORT ? 'forMe' : 'rated';
  // Landmarks | Neighborhoods at the top of the tab; Landmarks by default.
  const [subtab, setSubtab] = useState('landmarks');
  // Google ratings fetched for the Top Landmarks sort, this visit only.

  // Picking a city by hand (the dropdown) or GPS auto-pick already call
  // setMapFocus(id) themselves, right where they happen -- there used to
  // also be a useEffect here that set it from `cityFilter` on every render,
  // including the very first one. Since cityFilter's initial value is
  // trip.activeRegion (persisted per device, see above), that effect fired
  // on mount from whatever city was last browsed on THIS device, even on a
  // cold launch with no city actively chosen this session -- silently
  // locking the Map tab onto a stale city (indefinitely, since it's a
  // per-device localStorage value that survives app restarts) instead of
  // the "cold launch -> GPS, or all landmarks" behavior MapExplore's own
  // regionBounds is actually built to give. Removed; nothing here needs it.

  // A custom interest only filters anything once the AI has told us which
  // landmarks fit it. Normally that already happened when it was added on
  // Setup, but classify any that are still missing (e.g. the request never
  // finished, or it was added before this existed).
  useEffect(() => {
    trip.customInterests.forEach((text) => {
      if (trip.customInterestMatches[text] !== undefined) return;
      classifyInterest(text).then(({ matches, emoji, failed }) => {
        if (failed) return;
        setCustomInterestMatches(text, matches);
        setCustomInterestEmoji(text, emoji);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.customInterests]);

  const landmarkMatchesCategory = useCallback(
    (l, key) =>
      trip.customInterests.includes(key)
        ? (trip.customInterestMatches[key] || []).includes(`${l.regionId}/${l.id}`)
        : l.categories.includes(key),
    [trip.customInterests, trip.customInterestMatches]
  );

  // Same shape as ALL_LANDMARKS entries (regionId set from the doc's
  // `region` field) so the filter/sort/render logic below doesn't need to
  // know which source a landmark came from -- including defaults for
  // fields a custom doc might not have (an older submission, or one still
  // missing a field a newer feature added later). Without these, a single
  // malformed custom landmark crashes this whole screen the moment its
  // row tries to render (e.g. `l.categories.map(...)` on an undefined
  // categories) -- same defensive defaults LandmarkDetail.jsx already
  // applies for the same reason.
  const normalizedCustomLandmarks = useMemo(
    () =>
      customLandmarks.map((l) => ({
        ...l,
        regionId: l.region,
        categories: l.categories || [],
        images: l.images || [],
        facts: l.facts || [],
        free: l.free ?? true,
        typicalMinutes: l.typicalMinutes ?? 15,
      })),
    [customLandmarks]
  );

  // Admin Mode's live edits (name/category/etc) merged on top of the static
  // catalog -- same source of truth every other screen (map, detail page)
  // applies, so a correction shows up here too without a code deploy.
  const packsVersion = usePlacePacksVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- packsVersion: imported places join ALL_LANDMARKS in place
  const editedLandmarks = useMemo(() => ALL_LANDMARKS.map(applyEdit), [applyEdit, packsVersion]);

  // Everything but the search box: city and category filters.
  const passesFilters = (l) => {
    if (!inScope(l, scope) || (drawnShape && !inArea(l.lat, l.lng, drawnShape))) return false;
    if (activeCategories.length && !activeCategories.some((key) => landmarkMatchesCategory(l, key))) return false;
    if (foundOnly && hasFound && !isFound(l)) return false;
    return true;
  };

  // The search box, city and category filters applied, before any sort.
  const filteredLandmarks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...editedLandmarks, ...normalizedCustomLandmarks].filter((l) => {
      if (!inScope(l, scope) || (drawnShape && !inArea(l.lat, l.lng, drawnShape))) return false;
      if (activeCategories.length && !activeCategories.some((key) => landmarkMatchesCategory(l, key))) return false;
      if (foundOnly && hasFound && !isFound(l)) return false;
      if (term) {
        // Includes the city/region name and category labels too -- so a
        // query like "Miami F1" finds the Miami International Autodrome
        // even though no single field says "Miami F1" verbatim (see
        // matchesSearch).
        const categoryLabels = l.categories?.map((c) => INTERESTS.find((i) => i.id === c)?.label).filter(Boolean) ?? [];
        const haystack = [l.name, l.summary, getRegion(l.regionId)?.name, ...categoryLabels, ...(l.facts ?? [])].join(' ');
        if (!matchesSearch(haystack, term)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedLandmarks, normalizedCustomLandmarks, scope, drawnShape, activeCategories, foundOnly, hasFound, isFound, search]);

  // Top Landmarks ranks by Google's stars and review count, so it loads the
  // list's Google ratings first (src/lib/useTopRatings.js; signed in only).
  const topWanted = sortBy === 'rated' && !!user && !search.trim() && RATINGS_FLAGS.cardLine;
  const top = useTopRatings(filteredLandmarks, topWanted);
  const topLoading = topWanted && !top.ready;

  const sortedLandmarks = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = filteredLandmarks;
    // Near Me always means closest first, even while searching: "sushi" with
    // Near Me on lists the nearest sushi places first.
    if (term && sortBy === 'nearMe' && coords) {
      const dist = new Map(filtered.map((l) => [l, distanceMeters(coords.lat, coords.lng, l.lat, l.lng)]));
      return [...filtered].sort((a, b) => dist.get(a) - dist.get(b));
    }
    // Otherwise typing a name to find it is a lookup, not a browse -- the
    // best match first (then alphabetical) is what makes a known name fast
    // to spot, so a search term overrides For Me / Popular. Clearing the
    // search goes back to that sort.
    if (term) {
      // Best match first (name matches over description matches), then A-Z.
      const score = new Map(
        filtered.map((l) => [l, searchScore(l.name, [l.summary, getRegion(l.regionId)?.name, ...(l.facts ?? [])].join(' '), term)])
      );
      return [...filtered].sort((a, b) => score.get(b) - score.get(a) || a.name.localeCompare(b.name));
    }

    if (sortBy === 'nearMe' && coords) {
      return [...filtered].sort(
        (a, b) =>
          distanceMeters(coords.lat, coords.lng, a.lat, a.lng) - distanceMeters(coords.lat, coords.lng, b.lat, b.lng)
      );
    }
    if (sortBy === 'forMe') {
      const interests = new Set(trip.savedInterests || []);
      const scoresByRegion = new Map();
      const affinity = tasteKindAffinity(myReviews, (r) => getLandmark(r.region, r.landmarkId) || null, myProfile);
      const score = new Map(filtered.map((l) => [l, forMeScore(l, myProfile, interests, scoresByRegion, affinity)]));
      // Signed in: Mapr's ranking (maprRank/surfaces.js) over this fit --
      // distance decay keeps liked places first, then neutral, then disliked,
      // nearer first within each; plus similar places and the model. Ties
      // keep the Popular order.
      if (user?.uid) {
        const byPopular = [...filtered].sort((a, b) => popularScore(b, ratings) - popularScore(a, ratings) || a.name.localeCompare(b.name));
        const ranked = rankPlaces({
          places: byPopular.map((l) => ({ ...l, _src: l })),
          uid: user.uid,
          profile: myProfile,
          myReviews,
          origin: coords ? { lat: coords.lat, lng: coords.lng } : null,
          models: maprModels,
          scoreOf: (p) => score.get(p._src) || 0,
        }).ranked;
        return ranked.map((p) => p._src);
      }
      // Places that fit your taste first, then neutral ones, then categories
      // you've rated down -- closest first within each group. Without a
      // location yet, fall back to the strongest match first.
      if (coords) {
        const tier = (l) => (score.get(l) > 0 ? 0 : score.get(l) < 0 ? 2 : 1);
        const dist = new Map(filtered.map((l) => [l, distanceMeters(coords.lat, coords.lng, l.lat, l.lng)]));
        return [...filtered].sort((a, b) => tier(a) - tier(b) || dist.get(a) - dist.get(b));
      }
      return [...filtered].sort(
        (a, b) =>
          score.get(b) - score.get(a) ||
          popularScore(b, ratings) - popularScore(a, ratings) ||
          a.name.localeCompare(b.name)
      );
    }
    // Top Landmarks: Google's stars times the log of its review count
    // (src/lib/topRated.js), once the ratings are in (top.ready).
    if (topLoading) return [];
    return topLandmarksOrder(filtered, top.google, ratings);
  }, [filteredLandmarks, myProfile, myReviews, maprModels, user, trip.savedInterests, search, sortBy, coords, ratings, topLoading, top.google]);

  // Checked in vs not: an up arrow puts the places you haven't checked into
  // first, a down arrow puts the checked-in ones first, no arrow leaves the
  // sort above alone. Stable, so each group keeps that order. A search term
  // keeps its best-match order.
  const landmarks = useMemo(() => {
    if (!checkInOrder || search.trim()) return sortedLandmarks;
    const done = (l) => (claimedMap[l.id] ? 1 : 0);
    const dir = checkInOrder === 'up' ? 1 : -1;
    return [...sortedLandmarks].sort((a, b) => (done(a) - done(b)) * dir);
  }, [sortedLandmarks, checkInOrder, claimedMap, search]);

  // Row callbacks keep one identity for the life of the screen so the memoized
  // rows (867 of them) skip re-rendering when something unrelated changes.
  const latest = useRef({});
  latest.current = { toggleLandmark, checkIn, navigate, forMeLab };
  const stableToggle = useCallback((landmark) => latest.current.toggleLandmark(landmark.id, landmark.regionId), []);
  const stableCheckIn = useCallback((landmark) => latest.current.checkIn(landmark), []);
  const stableInfo = useCallback((landmark) => {
    const { cityFilter: city, shownPage: page } = latest.current;
    if (!latest.current.forMeLab) saveListReturn('landmarks', { y: window.scrollY, city, page, picked: cityPickedByHand.current });
    latest.current.navigate(`/landmarks/${landmark.regionId}/${landmark.id}`);
  }, []);

  // AI fallback when the word search finds little (catalog searched on the
  // server; community-added landmarks sent along), same filters applied.
  const customSearchItems = useMemo(
    () => normalizedCustomLandmarks.map((l) => ({ id: `custom:${l.id}`, text: landmarkSearchText(l, getRegion(l.regionId)?.name) })),
    [normalizedCustomLandmarks]
  );
  const smart = useSmartSearch({ query: search, localCount: landmarks.length, catalog: true, items: customSearchItems });
  const smartLandmarks = useMemo(() => {
    const shown = new Set(landmarks.map((l) => `${l.regionId}/${l.id}`));
    return smart.ids
      .map((id) =>
        id.startsWith('custom:')
          ? normalizedCustomLandmarks.find((l) => l.id === id.slice(7))
          : editedLandmarks.find((l) => `${l.regionId}/${l.id}` === id)
      )
      .filter((l) => l && !shown.has(`${l.regionId}/${l.id}`) && passesFilters(l));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.ids, landmarks, normalizedCustomLandmarks, editedLandmarks, scope, drawnShape, activeCategories]);

  // With Near Me on, Mapr's extra matches join the typed ones in one list,
  // closest first, instead of sitting in their own block below.
  const nearMeSearch = sortBy === 'nearMe' && !!coords && !!search.trim();
  const [showRestaurants, setShowRestaurants] = useState(false);
  const [showMalls, setShowMalls] = useState(false);
  const moreCounts = useMemo(() => {
    const malls = landmarks.filter(isMallPlace).length;
    return { malls, restaurants: landmarks.filter(isRestaurantOrMall).length - malls };
  }, [landmarks]);
  const allRows = useMemo(() => {
    if (nearMeSearch && smartLandmarks.length) {
      const d = (l) => distanceMeters(coords.lat, coords.lng, l.lat, l.lng);
      return [...landmarks, ...smartLandmarks].sort((a, b) => d(a) - d(b));
    }
    // Top Landmarks: restaurants and malls sit behind a tab under the list
    // (a category chip or a search lists them inline).
    if (sortBy === 'rated' && !search.trim() && !activeCategories.length && landmarks.some(isRestaurantOrMall)) {
      const main = landmarks.filter((l) => !isRestaurantOrMall(l));
      const malls = landmarks.filter(isMallPlace);
      const restaurants = landmarks.filter((l) => isRestaurantOrMall(l) && !isMallPlace(l));
      return [...main, MORE_TAB, ...(showRestaurants ? restaurants : []), ...(showMalls ? malls : [])];
    }
    return [...landmarks, ...(smartLandmarks.length ? [SMART_DIVIDER, ...smartLandmarks] : [])];
  }, [landmarks, smartLandmarks, nearMeSearch, coords, sortBy, search, activeCategories, showRestaurants, showMalls]);
  // Page 1 again whenever the search, sort, city or category changes.
  const pageKey = [sortBy, search, scopeKey, activeCategories.join(','), checkInOrder, foundOnly, !!drawnShape].join('|');
  const [page, setPage] = useState(Math.max(0, Number(returned?.page) || 0));
  const [seenPageKey, setSeenPageKey] = useState(pageKey);
  if (seenPageKey !== pageKey) {
    setSeenPageKey(pageKey);
    setPage(0);
  }
  const pageCount = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const shownPage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(() => allRows.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE), [allRows, shownPage]);
  const nextRows = useMemo(() => allRows.slice((shownPage + 1) * PAGE_SIZE, (shownPage + 2) * PAGE_SIZE), [allRows, shownPage]);
  // This page's Google ratings, then the next page's, loaded up front.
  // Top Landmarks already has them (top.live); other sorts load per page.
  const pageRatings = usePageRatings(pageRows, nextRows, !!user && RATINGS_FLAGS.cardLine && !topWanted);
  const goToPage = (n) => {
    setPage(n);
    window.scrollTo({ top: 0 });
  };
  latest.current.cityFilter = scopeKey;
  latest.current.shownPage = shownPage;
  // A new search, sort, city or category starts at the top again.
  const seenPageKeyScroll = useRef(pageKey);
  useEffect(() => {
    if (seenPageKeyScroll.current === pageKey) return;
    seenPageKeyScroll.current = pageKey;
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
  }, [pageKey]);
  const scrolledBack = useRef(false);
  // The retry loop must outlive the re-renders that follow (rows still
  // filling in, custom landmarks, models); cancelling it on each dependency
  // change cut it to a single scrollTo. Cancel only when leaving the screen.
  const cancelScrollBack = useRef(null);
  useEffect(() => {
    if (!returned || scrolledBack.current || !allRows.length) return;
    scrolledBack.current = true;
    // Back from a landmark: the page you left is already open (page state);
    // scroll to where you were on it.
    cancelScrollBack.current = restoreScroll(Number(returned.y) || 0);
  }, [returned, allRows.length]);
  useEffect(() => () => cancelScrollBack.current?.(), []);

  // Total across every city; and the count within the currently filtered city.
  const selectedCount = regionsWithItineraries().reduce((n, r) => n + getRegionSelection(r).length, 0);
  const scopeCount = scope.regionIds ? scope.regionIds.reduce((n, r) => n + getRegionSelection(r).length, 0) : selectedCount;
  // The places you have picked, listed in the bottom bar with a trash button
  // each (owner, 2026-11-05).
  const nameByKey = useMemo(() => new Map([...editedLandmarks, ...normalizedCustomLandmarks].map((l) => [`${l.regionId}/${l.id}`, l.name])), [editedLandmarks, normalizedCustomLandmarks]);
  const selectedPlaces = regionsWithItineraries().flatMap((r) => getRegionSelection(r).map((id) => ({ id, regionId: r, name: nameByKey.get(`${r}/${id}`) || id })));

  const renderRow = (l) => {
    if (l === MORE_TAB)
      return (
        <div key={l.id} style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
          {moreCounts.restaurants > 0 && (
            <button type="button" className="btn btn-ghost" style={{ flex: 1, minWidth: 0, padding: '8px 6px', fontSize: '0.82rem', whiteSpace: 'nowrap' }} aria-expanded={showRestaurants} onClick={() => setShowRestaurants((v) => !v)}>
              {'\u{1F37D}\u{FE0F}'} Restaurants ({moreCounts.restaurants}) {showRestaurants ? '\u25B2' : '\u25BC'}
            </button>
          )}
          {moreCounts.malls > 0 && (
            <button type="button" className="btn btn-ghost" style={{ flex: 1, minWidth: 0, padding: '8px 6px', fontSize: '0.82rem', whiteSpace: 'nowrap' }} aria-expanded={showMalls} onClick={() => setShowMalls((v) => !v)}>
              {'\u{1F6CD}\u{FE0F}'} Malls ({moreCounts.malls}) {showMalls ? '\u25B2' : '\u25BC'}
            </button>
          )}
        </div>
      );
    if (l === SMART_DIVIDER) return <SmartSearchLabel key={l.id} count={smartLandmarks.length} />;
    const photo = myPhotos[l.id]?.[0];
    const rating = ratings[l.id];
    return (
      <LandmarkRow
        key={`${l.regionId}-${l.id}`}
        l={l}
        isSelected={getRegionSelection(l.regionId).includes(l.id)}
        photo={photo}
        ratingAvg={rating?.count > 0 ? rating.avg : null}
        ratingCount={rating?.count || 0}
        ratingSources={(topWanted ? top.live[l.id] : pageRatings[ratingKey(l)]) || null}
        distanceText={coords ? formatDistance(distanceMeters(coords.lat, coords.lng, l.lat, l.lng), units) : null}
        user={user}
        firebaseEnabled={firebaseEnabled}
        claimedMap={claimedMap}
        checkingIn={checkingIn}
        onToggle={stableToggle}
        onCheckIn={stableCheckIn}
        onOpenPhoto={setLightbox}
        onInfo={stableInfo}
      />
    );
  };

  // Landmark cards go two to a row; the Restaurants/Malls tabs and the Mapr
  // divider sit between grids at full width.
  const segments = [];
  for (const row of pageRows) {
    const special = row === MORE_TAB || row === SMART_DIVIDER;
    const last = segments[segments.length - 1];
    if (special) segments.push({ special: row });
    else if (last && !last.special) last.rows.push(row);
    else segments.push({ rows: [row] });
  }

  const subtabs = forMeLab ? null : (
    <div className="lm-subtabs" role="tablist" aria-label="Landmarks or neighborhoods">
      {[
        { id: 'landmarks', label: 'Landmarks' },
        { id: 'neighborhoods', label: 'Neighborhoods' },
      ].map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={subtab === t.id} className={`lm-subtab ${subtab === t.id ? 'on' : ''}`} onClick={() => setSubtab(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );

  if (subtab === 'neighborhoods') {
    return (
      <div>
        {subtabs}
        <Neighborhoods />
      </div>
    );
  }

  return (
    <div>
      {subtabs}
      <div className="places-title-row">
        <h1 className="screen-title">
          <span>{forMeLab ? '\u{2728}' : '\u{1F4CD}'}</span> {forMeLab ? 'For Me' : 'Landmarks'}{topLoading ? '' : ` (${landmarks.length})`}
        </h1>
        {/* Your check-ins, opened on Grid (photos first). */}
        {user && !forMeLab && (
          <button
            type="button"
            className="btn btn-ghost btn-sm places-checkins-btn"
            onClick={() => navigate('/checkins', { state: { layout: 'grid', from: 'places' } })}
          >
            {'\u{1F4F8}'} My Memories
          </button>
        )}
      </div>
      {drawnShape && (
        <p className="screen-subtitle">
          {'\u{270F}\u{FE0F}'} In the area you drew on the Map
          <button type="button" className="lm-drawn-cancel" aria-label="Cancel the drawn area" title="Cancel the drawn area" onClick={() => setDrawnArea(null)}>
            {'\u{2715}'}
          </button>
        </p>
      )}

      <div className="field" style={{ marginBottom: 12 }}>
        <input
          type="search"
          name="landmark-search"
          aria-label="Search landmarks"
          autoComplete="off"
          enterKeyHint="search"
          placeholder={'\u{1F50D} Search landmarks…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {SHOW_ADD_LANDMARK && (
        <button
          type="button"
          className="btn btn-ghost btn-block"
          style={{ marginBottom: 12 }}
          onClick={() => navigate('/add-landmark')}
        >
          {'\u{2795}'} Add a Landmark
        </button>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        {scopeCount > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (!scope.regionIds) clearAll();
              else scope.regionIds.forEach((r) => clearRegion(r));
            }}
          >
            Clear ({scopeCount})
          </button>
        )}
        {/* Back to the city you are in, after following the Map somewhere
            else or picking another city. */}
        {gpsCity && scope.key !== `r:${gpsCity}` && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Back to the city you're in"
            aria-label="Back to the city you're in"
            onClick={() => {
              cityPickedByHand.current = false;
              setMapView(null);
              setCityFilter(gpsCity);
            }}
          >
            {'\u{27A4}'}
          </button>
        )}
      </div>

      <CityDropdown
        value={scope.key}
        onChange={(key) => {
          cityPickedByHand.current = true;
          setScopeKey(key);
          // Remember the city being browsed (so the Map opens on it too) and
          // that it was picked by hand, so GPS won't quietly override it later.
          const id = scopeRegionId(scopeFromKey(key));
          if (id) {
            updateTrip({ activeRegion: id, activeRegionPicked: true });
            setMapFocus(id);
          } else {
            updateTrip({ activeRegionPicked: true });
          }
        }}
      />

      {/* One icon button per category, styled like the sort buttons below.
          Tap to show only that category (tap more to add some); tap again
          to drop it. None picked shows every category. Custom interests
          typed on Setup get a button too. */}
      <div className="tabs lm-category-tabs" role="group" aria-label="Categories">
        {PICKABLE_INTERESTS.map((i) => {
          const on = activeCategories.includes(i.id);
          return (
            <button
              key={i.id}
              type="button"
              className={`tab-btn ${on ? 'active' : ''}`}
              aria-pressed={on}
              aria-label={i.label}
              title={i.label}
              data-cat={i.id}
              onClick={() => toggleCategory(i.id)}
            >
              <span className="lm-cat-glyph">{i.icon}</span>
            </button>
          );
        })}
        {trip.customInterests.map((text) => {
          const pending = trip.customInterestMatches[text] === undefined;
          const on = activeCategories.includes(text);
          return (
            <button
              key={text}
              type="button"
              className={`tab-btn ${on ? 'active' : ''}`}
              aria-pressed={on}
              aria-label={text}
              title={text}
              disabled={pending}
              onClick={() => toggleCategory(text)}
            >
              {pending ? '\u{23F3}' : trip.customInterestEmoji?.[text] || '\u{2728}'}
            </button>
          );
        })}
        {hasFound && (
          <button
            type="button"
            className={`tab-btn ${foundOnly ? 'active' : ''}`}
            aria-pressed={!!foundOnly}
            title="Found by people like you"
            onClick={() => setFoundOnly(!foundOnly)}
          >
            {'\u{1F465}'} Found by people
          </button>
        )}
      </div>

      <div className="tabs lm-sort-tabs" style={{ marginBottom: sortBy === 'nearMe' && !coords ? 4 : 18 }}>
        {(forMeLab ? FOR_ME_ONLY : SORT_OPTIONS).map((s) => (
          <button
            key={s.id}
            className={`tab-btn ${sortBy === s.id ? 'active' : ''}`} aria-pressed={!!(sortBy === s.id)}
            onClick={() => !forMeLab && setSortBy((cur) => (cur === s.id ? null : s.id))}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          className={`tab-btn ${checkInOrder ? 'active' : ''}`}
          aria-pressed={!!checkInOrder}
          aria-label={
            checkInOrder === 'up'
              ? 'Checked in order: places you have not checked into first. Tap for checked-in places first.'
              : checkInOrder === 'down'
                ? 'Checked in order: checked-in places first. Tap to turn off.'
                : 'Checked in order: off. Tap to put places you have not checked into first.'
          }
          onClick={() => setCheckInOrder((cur) => (cur === 'up' ? 'down' : cur === 'down' ? null : 'up'))}
        >
          {'\u{2705}'} Checked in
          {checkInOrder === 'up' ? ' \u{2191}' : checkInOrder === 'down' ? ' \u{2193}' : ''}
        </button>
      </div>
      {sortBy === 'nearMe' && !coords && (
        <p style={{ fontSize: '0.78rem', color: 'var(--color-parchment-dim)', marginBottom: 18 }}>
          Finding what's closest to me…
        </p>
      )}

      {customError && (
        <ErrorNotice
          compact
          message="Couldn't load community-added landmarks — showing the built-in ones."
          onRetry={loadCustomLandmarks}
        />
      )}

      {topLoading && <SkeletonList count={6} label="Ranking the top landmarks" />}
      <div>
        {segments.map((seg, i) =>
          seg.special ? (
            renderRow(seg.special)
          ) : (
            <div key={`grid-${i}`} className="nb-grid lm-grid">
              {seg.rows.map(renderRow)}
            </div>
          )
        )}
        {smart.loading && <SmartSearchLabel loading />}
        {!topLoading && landmarks.length === 0 && !smart.loading && smartLandmarks.length === 0 && (
          <p className="empty-state">No landmarks match these filters.</p>
        )}
      </div>

      {pageCount > 1 && (
        <nav className="lm-pager" aria-label="Landmark pages">
          <button type="button" className="btn btn-ghost btn-sm" disabled={shownPage === 0} onClick={() => goToPage(shownPage - 1)}>
            {'\u2039'} Previous
          </button>
          <span aria-live="polite" className="lm-pager-label">
            Page {shownPage + 1} of {pageCount}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={shownPage >= pageCount - 1} onClick={() => goToPage(shownPage + 1)}>
            Next {'\u203A'}
          </button>
        </nav>
      )}

      {/* Owner, 2026-11-05: the bar shows only once a landmark is picked, with
          the picked places on its right so a tap on the trash removes one. */}
      {selectedCount > 0 && (
        <>
          <div className="action-bar-spacer tall" />
          <div className="fixed-action-bar">
            <div className="fixed-action-bar-inner plan-bar">
              <button type="button" className="btn btn-primary plan-bar-go" onClick={() => navigate('/itinerary')}>
                Plan your game ({selectedCount}) {'→'}
              </button>
              <ul className="plan-bar-list" aria-label="Selected landmarks">
                {selectedPlaces.map((p) => (
                  <li key={`${p.regionId}/${p.id}`} className="plan-bar-item">
                    <span className="plan-bar-name">{p.name}</span>
                    <button type="button" className="plan-bar-trash" aria-label={`Remove ${p.name}`} onClick={() => stableToggle(p)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
      <Lightbox src={lightbox?.src} alt={lightbox?.alt} onClose={() => setLightbox(null)} />
    </div>
  );
}
