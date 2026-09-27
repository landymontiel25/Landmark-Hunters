import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTrip } from '../lib/TripContext';
import { useGeo } from '../lib/GeoContext';
import { useCheckIn } from '../lib/useCheckIn';
import { useRatings } from '../lib/RatingsContext';
import { useMyPhotos } from '../lib/MyPhotosContext';
import { distanceMeters } from '../lib/geo';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import DirectionsButton from '../components/DirectionsButton';
import { classifyInterest } from '../lib/interestClassifier';
import CheckInButton from '../components/CheckInButton';
import LandmarkThumb from '../components/LandmarkThumb';
import Lightbox from '../components/Lightbox';
import QuickRateButton from '../components/QuickRateButton';
import { ALL_LANDMARKS, PICKABLE_REGIONS, INTERESTS, sortInterests, getRegion } from '../data/regions';
import { getCustomLandmarks } from '../lib/customLandmarks';
import { useLandmarkEdits } from '../lib/LandmarkEditsContext';
import { matchesSearch, searchScore } from '../lib/search';
import { useSmartSearch, useSmartCitySearch, landmarkSearchText } from '../lib/smartSearch';
import SmartSearchLabel from '../components/SmartSearchLabel';
import { usePersistentState, useSessionState } from '../lib/usePersistentState';
import ErrorNotice from '../components/ErrorNotice';

// A null sort (every sort tab toggled off) is a real choice worth keeping.
const NEVER_EMPTY = () => false;
// Search/filter choices are handy for a while, not forever -- after a day
// the list opens fresh instead of mysteriously pre-filtered.
const DAY = 24 * 60 * 60 * 1000;

// Marks where AI-understood matches start in the landmark list.
const SMART_DIVIDER = { id: '__smart__' };

const CATEGORY_ICON = Object.fromEntries(INTERESTS.map((i) => [i.id, i.icon]));


const SORT_OPTIONS = [
  { id: 'nearMe', label: '\u{1F4CD} Near Me' },
  { id: 'popularity', label: '\u{1F525} Popular' },
];

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
  const filtered = PICKABLE_REGIONS.filter((r) => matchesSearch(r.city, term)).sort((a, b) =>
    a.city.localeCompare(b.city)
  );
  const smart = useSmartCitySearch(term, filtered, open);
  const selectedLabel = value === 'all' ? 'All Cities' : getRegion(value)?.city ?? 'All Cities';

  const choose = (id) => {
    onChange(id);
    setOpen(false);
    setSearch('');
  };

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
            placeholder={'\u{1F50D} Search cities…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="city-dropdown-list">
            <button type="button" className={`city-dropdown-item ${value === 'all' ? 'active' : ''}`} onClick={() => choose('all')}>
              All Cities
            </button>
            {filtered.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`city-dropdown-item ${value === r.id ? 'active' : ''}`}
                onClick={() => choose(r.id)}
              >
                {r.city}
              </button>
            ))}
            <SmartSearchLabel loading={smart.loading} count={smart.cities.length} />
            {smart.cities.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`city-dropdown-item ${value === r.id ? 'active' : ''}`}
                onClick={() => choose(r.id)}
              >
                {r.city}
              </button>
            ))}
            {filtered.length === 0 && !smart.loading && smart.cities.length === 0 && (
              <p className="city-dropdown-empty">No cities match.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LandmarkSelection() {
  const {
    trip,
    toggleLandmark,
    setRegionSelection,
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
  const { ratings } = useRatings();
  const navigate = useNavigate();

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
  // Always opens on every landmark. It used to start on trip.activeRegion,
  // which is saved per device and never expires -- so a city browsed once
  // (e.g. San Francisco) came back on every later visit, and a saved
  // "picked by hand" flag kept GPS from ever correcting it. Pick a city
  // from the dropdown to narrow the list for this visit.
  const [cityFilter, setCityFilter] = useState('all');
  // Default to every interest picked on Setup -- built-in categories AND custom
  // ones you typed in -- so "Choose Landmarks" opens already narrowed to what you
  // said you wanted instead of dumping every landmark on you. Empty selection (no
  // interests chosen, or "All" tapped) means show everything.
  // Starts on "All categories"; the dropdown narrows from there.
  // Category lasts while the app is open and resets every launch; search
  // text and sort survive closing the app (see usePersistentState).
  const [activeCategories, setActiveCategories] = useSessionState('landmarks.category', []);
  // A restored custom interest may have been removed since -- don't leave
  // the list filtered by something the dropdown can no longer show.
  useEffect(() => {
    const key = activeCategories[0];
    if (key && !INTERESTS.some((i) => i.id === key) && !trip.customInterests.includes(key)) setActiveCategories([]);
  }, [activeCategories, trip.customInterests, setActiveCategories]);
  // Tapping a row's thumbnail opens the photo full-screen.
  const [lightbox, setLightbox] = useState(null);
  const [search, setSearch] = usePersistentState('landmarks.search', '', { ttlMs: DAY });
  const [savedSort, setSortBy] = usePersistentState('landmarks.sort', 'popularity', { isEmpty: NEVER_EMPTY });
  // Top Rated folded into Popular; an old saved choice lands there.
  const sortBy = savedSort === 'nearMe' ? 'nearMe' : 'popularity';
  // Snapshot of each touched region's selection from right before the last
  // "Suggest For Me" applied, so pressing it again can undo exactly that --
  // no separate trip to Clear. Null means the button isn't in its "applied"
  // state (nothing to undo).
  const [suggestedSnapshot, setSuggestedSnapshot] = useState(null);

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
      classifyInterest(text).then(({ matches, emoji }) => {
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
  const editedLandmarks = useMemo(() => ALL_LANDMARKS.map(applyEdit), [applyEdit]);

  // Everything but the search box: city and category filters.
  const passesFilters = (l) => {
    if (cityFilter !== 'all' && l.regionId !== cityFilter) return false;
    if (activeCategories.length && !activeCategories.some((key) => landmarkMatchesCategory(l, key))) return false;
    return true;
  };

  const landmarks = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = [...editedLandmarks, ...normalizedCustomLandmarks].filter((l) => {
      if (cityFilter !== 'all' && l.regionId !== cityFilter) return false;
      if (activeCategories.length && !activeCategories.some((key) => landmarkMatchesCategory(l, key))) return false;
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

    // Typing a name to find it is a lookup, not a browse -- the best match
    // first (then alphabetical) is what makes a known name fast to spot, so
    // a search term overrides whichever Sort mode (Popular/Near
    // Me) is active. Clearing the search goes back to that sort.
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
    return [...filtered].sort(
      (a, b) =>
        (a.editorialRank ?? 99) - (b.editorialRank ?? 99) ||
        popularScore(b, ratings) - popularScore(a, ratings) ||
        a.name.localeCompare(b.name)
    );
  }, [
    cityFilter,
    activeCategories,
    landmarkMatchesCategory,
    search,
    sortBy,
    coords,
    ratings,
    normalizedCustomLandmarks,
    editedLandmarks,
  ]);

  const handleToggle = (landmark) => {
    toggleLandmark(landmark.id, landmark.regionId);
  };

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
  }, [smart.ids, landmarks, normalizedCustomLandmarks, editedLandmarks, cityFilter, activeCategories]);

  // Toggle: applying it snapshots each touched city's prior selection so a
  // second tap can put it back exactly, instead of making you find Clear.
  const suggestForMe = () => {
    if (suggestedSnapshot) {
      Object.entries(suggestedSnapshot).forEach(([r, ids]) => setRegionSelection(r, ids));
      setSuggestedSnapshot(null);
      return;
    }
    const keys = [...trip.interests, ...trip.customInterests];
    const interestKeys = keys.length ? keys : INTERESTS.map((i) => i.id);
    const matches = landmarks.filter((l) => interestKeys.some((key) => landmarkMatchesCategory(l, key)));
    const picked = (matches.length >= 8 ? matches : landmarks).slice(0, 10);
    if (!picked.length) return;
    // Group picks by city so each city's itinerary is set independently.
    const byR = {};
    picked.forEach((l) => {
      (byR[l.regionId] ||= []).push(l.id);
    });
    const prior = {};
    Object.keys(byR).forEach((r) => {
      prior[r] = getRegionSelection(r);
    });
    setSuggestedSnapshot(prior);
    Object.entries(byR).forEach(([r, ids]) => setRegionSelection(r, ids));
  };

  // Total across every city; and the count within the currently filtered city.
  const selectedCount = regionsWithItineraries().reduce((n, r) => n + getRegionSelection(r).length, 0);
  const scopeCount = cityFilter === 'all' ? selectedCount : getRegionSelection(cityFilter).length;
  const unselectedVisible =
    cityFilter === 'all'
      ? []
      : landmarks
          .filter((l) => l.regionId === cityFilter && !getRegionSelection(cityFilter).includes(l.id))
          .map((l) => l.id);

  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F4CD}'}</span> Choose Landmarks
      </h1>
      <p className="screen-subtitle">
        {activeCategories.length
          ? `${landmarks.length} landmarks matching your interests — pick what you want to see.`
          : `All ${landmarks.length} landmarks — pick everything you want to see.`}
      </p>

      <button
        type="button"
        className="btn btn-ghost btn-block"
        style={{ marginBottom: 12 }}
        onClick={() => navigate('/add-landmark')}
      >
        {'\u{2795}'} Add a Landmark
      </button>

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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <button className={`btn btn-sm ${suggestedSnapshot ? 'btn-primary' : 'btn-ghost'}`} onClick={suggestForMe}>
          {'✨'} {suggestedSnapshot ? 'Suggested ✓' : 'Suggest For Me'}
        </button>
        {/* One city at a time: "select all 74 landmarks everywhere" isn't a
            trip anyone plans. Adds whatever the current filters show. */}
        {cityFilter !== 'all' && unselectedVisible.length > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSuggestedSnapshot(null);
              setRegionSelection(cityFilter, [...getRegionSelection(cityFilter), ...unselectedVisible]);
            }}
          >
            {'\u{2705}'} Select All ({unselectedVisible.length})
          </button>
        )}
        {scopeCount > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSuggestedSnapshot(null);
              if (cityFilter === 'all') clearAll();
              else clearRegion(cityFilter);
            }}
          >
            Clear ({scopeCount})
          </button>
        )}
      </div>

      <CityDropdown
        value={cityFilter}
        onChange={(id) => {
          setCityFilter(id);
          // Remember the city being browsed (so the Map opens on it too) and
          // that it was picked by hand, so GPS won't quietly override it later.
          if (id !== 'all') {
            updateTrip({ activeRegion: id, activeRegionPicked: true });
            setMapFocus(id);
          } else {
            updateTrip({ activeRegionPicked: true });
          }
        }}
      />

      {/* One dropdown instead of a chip per category: with a dozen-plus
          categories the tab row wrapped onto four lines. Custom interests
          typed on Setup sit at the bottom of the same list. */}
      <div className="itin-toolbar" style={{ marginBottom: 10 }}>
        <label className="itin-sort">
          <span>Category</span>
          <select
            className="radius-select"
            value={activeCategories[0] || ''}
            onChange={(e) => setActiveCategories(e.target.value ? [e.target.value] : [])}
          >
            <option value="">All categories</option>
            {sortInterests(INTERESTS).map((i) => (
            <option key={i.id} value={i.id}>
              {i.icon} {i.label}
            </option>
          ))}
          {trip.customInterests.map((text) => {
            const pending = trip.customInterestMatches[text] === undefined;
            return (
              <option key={text} value={text} disabled={pending}>
                {pending ? '\u{23F3} ' : '\u{2728} '}
                {text}
              </option>
            );
          })}
          </select>
        </label>
      </div>

      <div className="tabs" style={{ marginBottom: sortBy === 'nearMe' && !coords ? 4 : 18 }}>
        {SORT_OPTIONS.map((s) => (
          <button
            key={s.id}
            className={`tab-btn ${sortBy === s.id ? 'active' : ''}`}
            onClick={() => setSortBy((cur) => (cur === s.id ? null : s.id))}
          >
            {s.label}
          </button>
        ))}
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

      <div>
        {[...landmarks, ...(smartLandmarks.length ? [SMART_DIVIDER, ...smartLandmarks] : [])].map((l) => {
          if (l === SMART_DIVIDER) return <SmartSearchLabel key={l.id} count={smartLandmarks.length} />;
          const isSelected = getRegionSelection(l.regionId).includes(l.id);
          return (
            <div
              key={`${l.regionId}-${l.id}`}
              className={`landmark-row ${isSelected ? 'selected' : ''} ${claimedMap[l.id] ? 'visited' : ''}`}
            >
              <div className="lr-top">
                <div
                  className="check-circle"
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-label={`${isSelected ? 'Remove' : 'Add'} ${l.name} ${isSelected ? 'from' : 'to'} itinerary`}
                  tabIndex={0}
                  onClick={() => handleToggle(l)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleToggle(l);
                    }
                  }}
                >
                  {isSelected ? '✓' : ''}
                </div>
                <div onClick={() => handleToggle(l)} style={{ flexShrink: 0 }}>
                  {(myPhotos[l.id]?.[0] || l.images?.[0]) ? (
                    <button
                      type="button"
                      className="lr-thumb-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightbox({ src: myPhotos[l.id]?.[0] || l.images[0], alt: l.name });
                      }}
                      aria-label={`View photo of ${l.name}`}
                    >
                      <LandmarkThumb landmark={l} myPhoto={myPhotos[l.id]?.[0]} />
                    </button>
                  ) : (
                    <LandmarkThumb landmark={l} myPhoto={myPhotos[l.id]?.[0]} />
                  )}
                </div>
                <div className="lr-main" onClick={() => handleToggle(l)}>
                  <h4>
                    <span className="lr-category-icons">{l.categories.map((c) => CATEGORY_ICON[c]).join('')}</span>
                    {l.name}
                    <QuickRateButton landmark={l} />
                  </h4>
                  <div className="lr-meta">
                    <span className={`tag ${l.free ? 'tag-free' : ''}`}>{l.free ? 'Free' : 'Ticketed'}</span>
                    {typeof l.popularity === 'number' && <span className="tag popularity-tag">{'\u{1F525}'} {l.popularity}/10</span>}
                    {ratings[l.id]?.count > 0 && (
                      <span className="tag rating-tag">{'⭐'} {ratings[l.id].avg.toFixed(1)} ({ratings[l.id].count})</span>
                    )}
                    {coords && (
                      <span className="tag distance-tag">
                        {'\u{1F4CD}'} {formatDistance(distanceMeters(coords.lat, coords.lng, l.lat, l.lng), units)} away
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="lr-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-tight"
                  onClick={() => navigate(`/landmarks/${l.regionId}/${l.id}`)}
                >
                  Info
                </button>
                <DirectionsButton name={l.name} lat={l.lat} lng={l.lng} className="btn btn-ghost btn-tight" />
                <CheckInButton
                  landmark={l}
                  user={user}
                  firebaseEnabled={firebaseEnabled}
                  claimedMap={claimedMap}
                  checkingIn={checkingIn}
                  onCheckIn={checkIn}
                  className="btn-tight"
                />
              </div>
            </div>
          );
        })}
        {smart.loading && <SmartSearchLabel loading />}
        {landmarks.length === 0 && !smart.loading && smartLandmarks.length === 0 && (
          <p className="empty-state">No landmarks match these filters.</p>
        )}
      </div>

      <div className="action-bar-spacer" />
      <div className="fixed-action-bar">
        <div className="fixed-action-bar-inner">
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={selectedCount === 0}
            onClick={() => navigate('/itinerary')}
          >
            Build Itinerary ({selectedCount}) {'→'}
          </button>
        </div>
      </div>
      <Lightbox src={lightbox?.src} alt={lightbox?.alt} onClose={() => setLightbox(null)} />
    </div>
  );
}
