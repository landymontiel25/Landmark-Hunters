import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MapContainer, AttributionControl, TileLayer, Marker, Popup, Tooltip, Polyline, useMap, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { ALL_LANDMARKS, ALL_LANDMARKS_BOUNDS, INTERESTS, getRegion, normalizeCategories } from '../data/regions';
import { SEARCHABLE_PLACES } from '../data/places';
import { useTrip } from '../lib/TripContext';
import { useGeo } from '../lib/GeoContext';
import { useZoomRadius, ZOOM_RADIUS_OPTIONS } from '../lib/useZoomRadius';
import { distanceMeters } from '../lib/geo';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { useCheckIn } from '../lib/useCheckIn';
import { useMyPhotos } from '../lib/MyPhotosContext';
import { getLandmarkOverrides, saveLandmarkPosition } from '../lib/landmarkOverrides';
import { getCustomLandmarks, deleteCustomLandmark, updateCustomLandmark } from '../lib/customLandmarks';
import { isAdmin } from '../lib/admins';
import { useAdminMode } from '../lib/AdminModeContext';
import { useLandmarkEdits } from '../lib/LandmarkEditsContext';
import MapCategoryFilter from '../components/MapCategoryFilter';
import { searchScore } from '../lib/search';
import CheckInButton from '../components/CheckInButton';
import DirectionsButton from '../components/DirectionsButton';
import TurnByTurnPanel from '../components/TurnByTurnPanel';
import ActiveNavOverlay from '../components/ActiveNavOverlay';
import { prepareRoute, navProgress } from '../lib/navProgress';
import { useSmartSearch, landmarkSearchText } from '../lib/smartSearch';
import SmartSearchLabel from '../components/SmartSearchLabel';
import { fetchDirections, buildNearestNeighborRoute, googleMapsMultiStopLegs } from '../lib/routing';
import LandmarkThumb from '../components/LandmarkThumb';
import QuickRateButton from '../components/QuickRateButton';
import { useSessionState } from '../lib/usePersistentState';
import { useToast, runOptimistic } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import OnboardingBanner from '../components/OnboardingBanner';
import { useRatings } from '../lib/RatingsContext';
import MapPicksOverlay from '../components/nearbyPicks/MapPicksOverlay';
import { PICKS_SHEET_H, distanceUnitLabel, optionToMiles } from '../lib/nearbyPicks';


// Turn-by-turn's actual route, once directions are up -- see the dimming
// rule on body.map-nav-open in theme.css.
const NAV_ROUTE_GREEN = '#22c55e';

const CATEGORY_LABEL = Object.fromEntries(INTERESTS.map((i) => [i.id, i.label]));

// Only 4 combinations exist -- cache them instead of building a fresh
// L.divIcon every render for every marker. Reusing the same icon object also
// avoids feeding unnecessary churn into the marker cluster layer, which
// rebuilds (visibly, including any open popup) when it sees new icon refs.
const PIN_ICON_CACHE = new Map();

function pinIcon(checkedIn, addedToTrip) {
  const key = `${checkedIn}-${addedToTrip}`;
  if (!PIN_ICON_CACHE.has(key)) {
    PIN_ICON_CACHE.set(
      key,
      L.divIcon({
        className: '',
        html: `
          <div class="map-pin-wrap">
            <div class="map-pin ${checkedIn ? 'map-pin-checked-in' : ''}"></div>
            ${addedToTrip ? '<span class="map-pin-star">★</span>' : ''}
          </div>
        `,
        // The 20px pin sits at the wrap's top-left and rotates about its own
        // center (10,10); its square corner lands 10*sqrt(2) below that, so
        // the tip is at (10, 24) -- that's the point that must sit on the
        // coordinate, not the wrap's bottom edge.
        iconSize: [22, 26],
        iconAnchor: [10, 24],
        popupAnchor: [0, -28],
      })
    );
  }
  return PIN_ICON_CACHE.get(key);
}

// A marker's icon is one of the (checkedIn, addedToTrip) instances cached by
// pinIcon -- comparing identity against the two "checked in" cache entries is
// enough to tell without needing a second source of truth per marker.
function isCheckedInIcon(icon) {
  return icon === PIN_ICON_CACHE.get('true-false') || icon === PIN_ICON_CACHE.get('true-true');
}

function clusterIcon(cluster) {
  const children = cluster.getAllChildMarkers();
  const count = children.length;
  const size = count < 10 ? 34 : count < 30 ? 42 : 50;
  const allCheckedIn = count > 0 && children.every((m) => isCheckedInIcon(m.options.icon));
  return L.divIcon({
    className: '',
    html: `<div class="map-cluster ${allCheckedIn ? 'map-cluster-done' : ''}" style="width:${size}px;height:${size}px;">${count}</div>`,
    iconSize: [size, size],
  });
}

const userIcon = L.divIcon({
  className: '',
  html: '<div class="map-pin-user"><div class="map-pin-user-pulse"></div></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// Bright, unmistakable pin for the landmark you just came from.
const focusIcon = L.divIcon({
  className: '',
  html: '<div class="map-pin-focus"></div>',
  // Same geometry as pinIcon: 26px pin centered at (13,13), tip at 13+13*sqrt(2).
  iconSize: [28, 32],
  iconAnchor: [13, 31],
  popupAnchor: [0, -36],
});

// Numbered stop on a trip's route ("View in Map" from a group trip).
const tripStopIconCache = new Map();
function tripStopIcon(n) {
  if (!tripStopIconCache.has(n)) {
    tripStopIconCache.set(
      n,
      L.divIcon({ className: '', html: `<div class="trip-stop-pin">${n}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] })
    );
  }
  return tripStopIconCache.get(n);
}

const TILE_LAYERS = {
  street: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
  },
};

// Web Mercator meters-per-pixel-at-zoom-0-at-the-equator constant.
const EARTH_MPP_ZOOM0 = 156543.03392;
const METERS_PER_MILE = 1609.34;

// Zoom level such that `miles` is visible across the map's on-screen WIDTH
// (the dimension people actually eyeball for "how far is this"), independent
// of the container's aspect ratio.
function zoomForRadiusMiles(map, lat, miles) {
  const width = map.getSize().x;
  const metersPerPixel = (miles * METERS_PER_MILE) / width;
  return Math.log2((EARTH_MPP_ZOOM0 * Math.cos((lat * Math.PI) / 180)) / metersPerPixel);
}

function InitialView({ coords, lastKnown, bounds, regionBounds, stopBounds, focusPoint, radiusMiles }) {
  const map = useMap();
  const framed = useRef(null); // 'fixed' (a landmark, itinerary or city) | 'provisional' | 'gps'
  const userMoved = useRef(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => map.invalidateSize());
    return () => cancelAnimationFrame(id);
  }, [map]);

  // Once you pan the map yourself, a late GPS fix doesn't yank it away.
  useMapEvents({
    dragstart: () => {
      userMoved.current = true;
    },
  });

  useEffect(() => {
    if (framed.current === 'fixed' || framed.current === 'gps') return;
    // Priority: a specific landmark ("See it on the Map") → every stop of
    // the itinerary you came from → the city you're browsing → your GPS
    // location. Never waits on GPS: until a fix comes in, the map opens on
    // your last known location (or every landmark), then moves to you.
    if (focusPoint) {
      framed.current = 'fixed';
      map.setView([focusPoint.lat, focusPoint.lng], 17);
    } else if (stopBounds) {
      framed.current = 'fixed';
      map.fitBounds(stopBounds, { padding: [50, 50], maxZoom: 16 });
    } else if (regionBounds) {
      framed.current = 'fixed';
      map.fitBounds(regionBounds, { padding: [40, 40] });
    } else if (coords) {
      if (!(framed.current === 'provisional' && userMoved.current)) {
        map.setView([coords.lat, coords.lng], zoomForRadiusMiles(map, coords.lat, radiusMiles));
      }
      framed.current = 'gps';
    } else if (!framed.current) {
      framed.current = 'provisional';
      if (lastKnown) map.setView([lastKnown.lat, lastKnown.lng], zoomForRadiusMiles(map, lastKnown.lat, radiusMiles));
      else map.fitBounds(bounds, { padding: [30, 30] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, regionBounds, focusPoint]);

  return null;
}

// Long-press on touch (and right-click on desktop) fires Leaflet's
// 'contextmenu' event -- no separate gesture library needed to let someone
// pin an exact spot that isn't one of the built-in landmarks.
function PinDropHandler({ onDrop, disabled }) {
  useMapEvents({
    contextmenu(e) {
      if (disabled) return;
      onDrop({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function LocateControl({ coords, radiusMiles }) {
  const map = useMap();
  return (
    <button
      type="button"
      className="map-locate-btn"
      disabled={!coords}
      title={coords ? 'Center on my location' : 'Locating…'}
      onClick={() => coords && map.flyTo([coords.lat, coords.lng], zoomForRadiusMiles(map, coords.lat, radiusMiles))}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" transform="rotate(45 12 12)" />
      </svg>
    </button>
  );
}

// Frames the whole route once directions come back (and again after a
// refresh), leaving room at the bottom for the steps sheet.
function FitNavRoute({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points?.length > 1) map.fitBounds(points, { paddingTopLeft: [80, 110], paddingBottomRight: [40, 340] });
  }, [map, points]);
  return null;
}

// Frames a trip's whole route once, when it's first shown.
function FitTripRoute({ points }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length < 1) return;
    done.current = true;
    if (points.length === 1) map.setView(points[0], 16);
    else map.fitBounds(points, { paddingTopLeft: [40, 110], paddingBottomRight: [40, 360], maxZoom: 16 });
  }, [map, points]);
  return null;
}

// While navigating, keeps the map centered on you (zoomed in to street
// level). Dragging the map pauses following until Recenter is tapped.
function FollowUser({ pos, following, onUserPan }) {
  const map = useMap();
  useMapEvents({ dragstart: onUserPan });
  useEffect(() => {
    if (!following || !pos) return;
    map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 17), { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pos?.lat, pos?.lng, following]);
  return null;
}

// Off the route this many fixes in a row -> fetch a new route from here,
// but no more often than every REROUTE_MS.
const OFF_ROUTE_FIXES = 2;
const REROUTE_MS = 15000;

export default function MapExplore() {
  const { toggleLandmark, getRegionSelection, trip, mapFocus, mapFocusPoint, setMapFocusPoint, mapFocusStops } = useTrip();
  const { user, firebaseEnabled, claimedMap, checkingIn, checkIn } = useCheckIn();
  const { adminMode } = useAdminMode();
  const { applyEdit } = useLandmarkEdits();
  const { myPhotos } = useMyPhotos();
  const navigate = useNavigate();
  const { coords, error: geoError, loading: geoLoading, lastKnown } = useGeo();
  const { units } = useUnits();
  const mapRef = useRef(null);
  const location = useLocation();
  const [satellite] = useState(true);
  const toast = useToast();

  // "Use the Map" from any Get Directions sheet (DirectionsButton) lands
  // here with location.state.directionsTo. The route runs from your live
  // location, so a request waits for the GPS fix if it hasn't come in yet.
  // active: live navigation (following you, next turn up top). queue: the
  // itinerary stops still to go after this one, offered on arrival.
  const [nav, setNav] = useState(null); // { dest, loading, error, data, req, active, queue }
  useEffect(() => {
    const dest = location.state?.directionsTo;
    if (!dest) return;
    mapRef.current?.closePopup();
    setNav({
      dest,
      loading: true,
      error: null,
      data: null,
      req: 0,
      active: !!location.state?.startNav,
      queue: location.state?.directionsQueue || [],
    });
    // Clear it so a reload or back-navigation doesn't re-open directions.
    navigate(location.pathname, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
  // "View in Map" from a group trip: its stops, in the most efficient order
  // from where you are, with the route drawn and Start for live navigation.
  const [tripRoute, setTripRoute] = useState(null); // { name, stops: [{ id, name, lat, lng }] }
  useEffect(() => {
    const tr = location.state?.tripRoute;
    if (!tr?.stops?.length) return;
    mapRef.current?.closePopup();
    setTripRoute(tr);
    navigate(location.pathname, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const coordsRef = useRef(coords);
  coordsRef.current = coords;
  const hasFix = !!coords;
  useEffect(() => {
    if (!nav?.loading) return undefined;
    const from = coordsRef.current;
    if (!from) {
      if (geoError) {
        setNav((cur) => cur && { ...cur, loading: false, error: 'Turn on location to get directions on the map.' });
      }
      return undefined;
    }
    let cancelled = false;
    const dest = nav.dest;
    fetchDirections(from, dest)
      .then((data) => !cancelled && setNav((cur) => (cur?.dest === dest ? { ...cur, loading: false, data } : cur)))
      .catch(
        (e) =>
          !cancelled &&
          setNav((cur) =>
            cur?.dest === dest
              ? { ...cur, loading: false, error: friendlyError(e, "Couldn't get directions right now. Try again.") }
              : cur
          )
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav?.dest, nav?.req, nav?.loading, hasFix, geoError]);
  // The floating Ask AI button would sit on top of the steps sheet.
  useEffect(() => {
    document.body.classList.toggle('map-nav-open', !!nav);
    return () => document.body.classList.remove('map-nav-open');
  }, [nav]);
  const refreshNav = () => setNav((cur) => cur && { ...cur, loading: true, error: null, req: cur.req + 1 });

  // Ordered once you have a location (GPS, else where you last were); the
  // order doesn't reshuffle as you move.
  const tripOrigin = coords || lastKnown || null;
  const hasTripOrigin = !!tripOrigin;
  const orderedTrip = useMemo(() => {
    if (!tripRoute) return null;
    const origin = tripOrigin || tripRoute.stops[0];
    return { origin: tripOrigin, stops: buildNearestNeighborRoute(origin, tripRoute.stops) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripRoute, hasTripOrigin]);
  const startTripRoute = () => {
    if (!orderedTrip?.stops.length) return;
    const [first, ...rest] = orderedTrip.stops.map((st) => ({ name: st.name, lat: st.lat, lng: st.lng }));
    setFollowing(true);
    setNav({ dest: first, queue: rest, loading: true, error: null, data: null, req: 0, active: true });
    setTripRoute(null);
  };

  // Live navigation: where you are along the route on every GPS fix.
  const navRoute = useMemo(() => (nav?.data?.points?.length > 1 ? prepareRoute(nav.data) : null), [nav?.data]);
  const alongRef = useRef(0);
  const arrivedRef = useRef(false);
  useEffect(() => {
    alongRef.current = 0;
    arrivedRef.current = false;
  }, [navRoute]);
  const navActive = !!nav?.active;
  const progress = useMemo(
    () => (navActive && navRoute && coords ? navProgress(navRoute, coords, alongRef.current) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navActive, navRoute, coords?.lat, coords?.lng]
  );
  const [following, setFollowing] = useState(true);
  const offRouteCountRef = useRef(0);
  const lastRerouteRef = useRef(0);
  useEffect(() => {
    if (!progress) return;
    alongRef.current = progress.along;
    if (progress.arrived) arrivedRef.current = true;
    // After arriving, drifting off the line is just GPS noise: no reroute.
    if (arrivedRef.current || !progress.offRoute) {
      offRouteCountRef.current = 0;
      return;
    }
    offRouteCountRef.current += 1;
    if (offRouteCountRef.current >= OFF_ROUTE_FIXES && !nav.loading && Date.now() - lastRerouteRef.current > REROUTE_MS) {
      lastRerouteRef.current = Date.now();
      offRouteCountRef.current = 0;
      refreshNav();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);
  const startLiveNav = () => {
    setFollowing(true);
    setNav((cur) => cur && { ...cur, active: true });
  };
  const goToNextStop = () => {
    setFollowing(true);
    setNav((cur) =>
      cur?.queue?.length
        ? { dest: cur.queue[0], queue: cur.queue.slice(1), loading: true, error: null, data: null, req: 0, active: true }
        : null
    );
  };
  // Only the part of the route still ahead of you, once you're moving.
  const remainingPoints = useMemo(() => {
    if (!navRoute) return null;
    if (!progress || !coords) return navRoute.points;
    const i = navRoute.cum.findIndex((c) => c > progress.along);
    return i === -1 ? [[coords.lat, coords.lng]] : [[coords.lat, coords.lng], ...navRoute.points.slice(i)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRoute, progress]);
  useEffect(() => {
    document.body.classList.toggle('map-nav-active', navActive);
    return () => document.body.classList.remove('map-nav-active');
  }, [navActive]);
  // The menu number (5 = 5 mi or 5 km, per the units setting).
  const [radiusOption, setRadiusMiles] = useZoomRadius();
  const radiusMiles = optionToMiles(radiusOption, units);

  // "Picked for you right now": a sheet over the map, signed in, once the
  // account's ratings have loaded. It steps aside (hidden, not unmounted)
  // for directions, a trip route and pin placement, which use the same spot
  // above the tab bar, and while the search or category panel is open
  // (their lists run down the screen). Opens on the top three every launch;
  // minimized lasts while the app is open, so it doesn't pop back up on
  // every visit to the Map tab.
  const { myReviewsLoaded } = useRatings();
  const [picksExpanded, setPicksExpanded] = useState(false);
  const [picksMinimized, setPicksMinimized] = useSessionState('map.picksMinimized', false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // Which categories to plot. Empty means "all landmarks" (the default);
  // otherwise only pins whose category is in the set. Grows with INTERESTS,
  // so every category added later is filterable here automatically.
  const [filterOpen, setFilterOpen] = useState(false);
  // Lasts while the app is open, resets every launch: a filter saved to the
  // device used to reopen days later with most pins silently hidden.
  const [filterCatList, setFilterCatList] = useSessionState('map.filterCats', []);
  const filterCats = useMemo(() => new Set(normalizeCategories(filterCatList)), [filterCatList]);
  const setFilterCats = (set) => setFilterCatList([...set]);
  const toggleFilterCat = (id) =>
    setFilterCatList((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  const passesFilter = (l) => filterCats.size === 0 || (l.categories || []).some((c) => filterCats.has(c));

  // Moving a built-in landmark's pin: Admin Mode only (same as moving a
  // custom pin, or any other admin write) -- a drop saves the corrected
  // spot to the landmark_overrides collection (landmarkOverrides.js).
  // firestore.rules enforces this server-side too, not just here.
  const [pinSavedNote, setPinSavedNote] = useState(null);
  useEffect(() => {
    if (!pinSavedNote) return;
    const t = setTimeout(() => setPinSavedNote(null), 2500);
    return () => clearTimeout(t);
  }, [pinSavedNote]);
  const handlePinDragEnd = (l, e) => {
    const { lat, lng } = e.target.getLatLng();
    savePinPosition(l, { lat, lng });
  };
  // Optimistic: the pin stays where you dropped it and says "Saved" right
  // away; if the write fails it hops back to where it was, with a Retry.
  const savePinPosition = (l, pos) => {
    const key = `${l.regionId}/${l.id}`;
    const before = overridesRef.current[key];
    runOptimistic({
      apply: () => {
        setSavedOverrides((prev) => ({ ...prev, [key]: pos }));
        setPinSavedNote(l.name);
      },
      commit: () => saveLandmarkPosition({ region: l.regionId, id: l.id, name: l.name, ...pos, userId: user?.uid }),
      rollback: () => {
        setPinSavedNote(null);
        setSavedOverrides((prev) => {
          const next = { ...prev };
          if (before) next[key] = before;
          else delete next[key];
          return next;
        });
      },
      toast,
      errorMessage: `Couldn't save the new spot for ${l.name}, so it's back where it was.`,
      retry: () => savePinPosition(l, pos),
    });
  };

  // A pin dropped by long-pressing an exact spot on the map -- lets you
  // pinpoint somewhere that isn't one of the built-in landmarks (e.g. a
  // specific building on a campus) and carry that exact location straight
  // into Add Landmark instead of having to re-find it there.
  const [pinDrop, setPinDrop] = useState(null);

  // "+" no longer jumps straight into Add Landmark -- it drops into this
  // mode instead: a crosshair stays fixed at the screen's center while you
  // pan the map underneath it, and every other control hides so the map
  // is the only thing on screen until you confirm with Done (or back out
  // with Cancel).
  const [placingPin, setPlacingPin] = useState(false);
  useEffect(() => {
    document.body.classList.toggle('pin-placing', placingPin);
    return () => document.body.classList.remove('pin-placing');
  }, [placingPin]);

  const startPlacingPin = () => {
    setPinDrop(null);
    setSearchOpen(false);
    setPlacingPin(true);
  };

  const confirmPinPlacement = () => {
    const center = mapRef.current?.getCenter();
    if (!center) return;
    setPlacingPin(false);
    navigate('/add-landmark', { state: { lat: center.lat, lng: center.lng } });
  };

  // Pin corrections made in "Move pins" mode, shared for everyone via
  // Firestore -- applied wherever a landmark's position is used below
  // (markers, search, nearby, and the "See it on the Map" highlight pin)
  // instead of falling back to the static source data's position.
  const [savedOverrides, setSavedOverrides] = useState({});
  // Latest values for the optimistic handlers below, which live inside
  // memoized markers and so can hold an older render's closure.
  const overridesRef = useRef(savedOverrides);
  overridesRef.current = savedOverrides;

  // Custom (user-submitted) landmarks, added via the dedicated "Add
  // Landmark" page and merged onto the map alongside the built-in ones.
  const [customLandmarks, setCustomLandmarks] = useState([]);
  const customLandmarksRef = useRef(customLandmarks);
  customLandmarksRef.current = customLandmarks;

  // The built-in pins always show; these two only add community pins and
  // pin corrections on top. If either fails, one quiet toast offers a retry
  // instead of the map silently missing pins.
  const loadSharedPins = useCallback(() => {
    Promise.allSettled([
      getLandmarkOverrides().then(setSavedOverrides),
      getCustomLandmarks().then(setCustomLandmarks),
    ]).then((results) => {
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) {
        toast.show(friendlyError(failed.reason, "Couldn't load community-added pins."), {
          actionLabel: 'Try again',
          onAction: loadSharedPins,
        });
      }
    });
  }, [toast]);
  useEffect(() => {
    loadSharedPins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optimistic: the pin disappears on tap and comes back (with Retry) if
  // the delete is refused.
  const removeCustomLandmark = (docId) => {
    const removed = customLandmarksRef.current.find((l) => l.docId === docId);
    runOptimistic({
      apply: () => {
        mapRef.current?.closePopup();
        setCustomLandmarks((prev) => prev.filter((l) => l.docId !== docId));
      },
      commit: () => deleteCustomLandmark(docId),
      rollback: () =>
        removed && setCustomLandmarks((prev) => (prev.some((l) => l.docId === docId) ? prev : [...prev, removed])),
      toast,
      errorMessage: "Couldn't remove that pin, so we put it back.",
      retry: () => removeCustomLandmark(docId),
    });
  };

  // The landmark you picked from search results — highlighted the same way
  // as "See it on the Map" from a landmark's detail page.
  const [searchFocus, setSearchFocus] = useState(null);

  // Capture the "fly to this landmark" request once (set when you view a
  // landmark), then clear the shared value so a later plain Map open doesn't
  // keep re-focusing it. The captured copy stays for this map view — it centers
  // the map AND drops a bright, named pin so you know exactly which one it is.
  const [focusLandmark] = useState(() => mapFocusPoint);
  useEffect(() => {
    if (mapFocusPoint) setMapFocusPoint(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // LandmarkDetail snapshots the landmark's static lat/lng when it sets this
  // up -- apply any drag-to-fix correction here too, or the highlighted
  // "you came from here" pin sits at the OLD spot while the real marker (in
  // `markers` below) sits at the corrected one, which looks like two pins
  // for one landmark.
  const focusLandmarkPos = useMemo(() => {
    if (!focusLandmark) return null;
    const savedPos =
      focusLandmark.regionId && focusLandmark.id ? savedOverrides[`${focusLandmark.regionId}/${focusLandmark.id}`] : null;
    return { ...focusLandmark, lat: savedPos?.lat ?? focusLandmark.lat, lng: savedPos?.lng ?? focusLandmark.lng };
  }, [focusLandmark, savedOverrides]);

  // The city you actively opened this session (list / detail / itinerary). The
  // map frames it when present; on a cold launch it's null, so we fall back to
  // your GPS location instead of the last city you looked at.
  const regionBounds = useMemo(() => {
    const r = mapFocus ? getRegion(mapFocus) : null;
    if (!r?.landmarks?.length) return null;
    const lats = r.landmarks.map((l) => l.lat);
    const lngs = r.landmarks.map((l) => l.lng);
    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
  }, [trip.activeRegion]);

  // Opened from an itinerary: frame all of its stops (captured once, so
  // later changes don't yank the map around while you're using it).
  const [stopBounds] = useState(() => {
    if (!mapFocusStops?.length) return null;
    const lats = mapFocusStops.map((p) => p.lat);
    const lngs = mapFocusStops.map((p) => p.lng);
    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
  });

  const handleRadiusChange = (e) => {
    const n = Number(e.target.value);
    setRadiusMiles(n);
    const miles = optionToMiles(n, units);
    if (coords && mapRef.current) {
      mapRef.current.flyTo([coords.lat, coords.lng], zoomForRadiusMiles(mapRef.current, coords.lat, miles));
    }
  };

  const handleAdd = (landmark) => {
    toggleLandmark(landmark.id, landmark.regionId);
  };

  const searchResults = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return [];
    // Includes the city/region name, category labels and facts too, joined
    // into one haystack -- so a query like "Miami F1" finds the Miami
    // International Autodrome even though no single field says "Miami F1"
    // verbatim (see matchesSearch: every WORD in the query has to appear
    // somewhere in the haystack, not the whole phrase in one field).
    const landmarkMatches = ALL_LANDMARKS.map((l) => {
      const categoryLabels = l.categories?.map((c) => CATEGORY_LABEL[c]).filter(Boolean) ?? [];
      const details = [l.summary, getRegion(l.regionId)?.name, ...categoryLabels, ...(l.facts ?? [])].join(' ');
      return { l, score: searchScore(l.name, details, term) };
    }).filter((x) => x.score > 0).map(({ l, score }) => {
      // A drag-to-fix correction (savedOverrides) has to win here too, or
      // jumping to a landmark via search flies you back to its original,
      // wrong spot -- right next to where the corrected pin actually sits,
      // which reads as two of it on the map.
      const savedPos = savedOverrides[`${l.regionId}/${l.id}`];
      return {
        // A landmark's own id is only unique within its region (two cities
        // can both have a "the-battery"), so the region has to be part of
        // the key too -- otherwise two different results collide on one
        // React key and the list can visibly duplicate/misrender as you type.
        id: `landmark-${l.regionId}-${l.id}`,
        name: l.name,
        sub: getRegion(l.regionId)?.name,
        lat: savedPos?.lat ?? l.lat,
        lng: savedPos?.lng ?? l.lng,
        zoom: 17,
        score,
      };
    });
    // User-submitted landmarks were never searchable here -- only via the
    // map pins themselves or the Landmarks tab. Same id/key pattern as the
    // static matches above, just namespaced with "custom-" since a custom
    // landmark's own id (from customLandmarks.js) is already globally
    // unique on its own.
    const customMatches = customLandmarks
      .map((l) => ({ l, score: searchScore(l.name, [l.summary, getRegion(l.region)?.name].join(' '), term) }))
      .filter((x) => x.score > 0)
      .map(({ l, score }) => ({
        id: `custom-${l.docId}`,
        name: l.name,
        sub: getRegion(l.region)?.name,
        lat: l.lat,
        lng: l.lng,
        zoom: 17,
        score,
      }));
    const placeMatches = SEARCHABLE_PLACES.map((p) => ({ ...p, score: searchScore(p.name, '', term) })).filter((p) => p.score > 0);
    // Best match first -- a name match beats a word buried in a description.
    return [...landmarkMatches, ...customMatches, ...placeMatches].sort((a, b) => b.score - a.score).slice(0, 8);
  }, [searchTerm, savedOverrides, customLandmarks]);

  // AI fallback when the word search finds little: catalog on the server,
  // custom landmarks sent along.
  const customSearchItems = useMemo(
    () => customLandmarks.map((l) => ({ id: `custom:${l.docId}`, text: landmarkSearchText(l, getRegion(l.region)?.name) })),
    [customLandmarks]
  );
  const smart = useSmartSearch({ query: searchTerm, localCount: searchResults.length, catalog: true, items: customSearchItems });
  const smartResults = useMemo(() => {
    const seen = new Set(searchResults.map((r) => r.id));
    return smart.ids
      .map((id) => {
        if (id.startsWith('custom:')) {
          const l = customLandmarks.find((c) => c.docId === id.slice(7));
          return l && { id: `custom-${l.docId}`, name: l.name, sub: getRegion(l.region)?.name, lat: l.lat, lng: l.lng, zoom: 17 };
        }
        const [rid, lid] = id.split('/');
        const l = ALL_LANDMARKS.find((x) => x.regionId === rid && x.id === lid);
        if (!l) return null;
        const savedPos = savedOverrides[`${l.regionId}/${l.id}`];
        return {
          id: `landmark-${l.regionId}-${l.id}`,
          name: l.name,
          sub: getRegion(l.regionId)?.name,
          lat: savedPos?.lat ?? l.lat,
          lng: savedPos?.lng ?? l.lng,
          zoom: 17,
        };
      })
      .filter((r) => r && !seen.has(r.id));
  }, [smart.ids, searchResults, customLandmarks, savedOverrides]);

  const selectSearchResult = (result) => {
    setSearchFocus(result);
    setSearchOpen(false);
    setSearchTerm('');
    mapRef.current?.flyTo([result.lat, result.lng], result.zoom);
  };

  const toggleSearch = () => {
    setSearchOpen((open) => !open);
    setSearchTerm('');
    setFilterOpen(false);
  };

  // A live, distance-sorted view of what's closest right now, shown in the
  // search panel before you type anything. Only meaningful with a real GPS
  // fix, so it's just not offered without one.
  // Measured from a ~110 m grid, so GPS jitter while standing still doesn't
  // reshuffle (and mis-tap) the rows.
  const listLat = coords ? Math.round(coords.lat * 1000) / 1000 : null;
  const listLng = coords ? Math.round(coords.lng * 1000) / 1000 : null;
  const nearbyList = useMemo(() => {
    if (listLat == null) return [];
    const all = [
      ...ALL_LANDMARKS.map((l) => {
        const savedPos = savedOverrides[`${l.regionId}/${l.id}`];
        return {
          id: `landmark-${l.regionId}-${l.id}`,
          name: l.name,
          region: l.regionId,
          landmarkId: l.id,
          lat: savedPos?.lat ?? l.lat,
          lng: savedPos?.lng ?? l.lng,
        };
      }),
      ...customLandmarks.map((l) => ({ id: `custom-${l.docId}`, name: l.name, region: l.region, landmarkId: l.id, lat: l.lat, lng: l.lng })),
    ];
    return all
      .map((l) => ({ ...l, meters: distanceMeters(listLat, listLng, l.lat, l.lng) }))
      .sort((a, b) => a.meters - b.meters)
      .slice(0, 12);
  }, [listLat, listLng, customLandmarks, savedOverrides]);

  // Build the markers once and reuse the same elements across re-renders. GPS
  // ticks update `coords` several times a minute; if the markers were rebuilt
  // inline each time, the whole cluster layer (and any open popup) would tear
  // down and flash. We only rebuild when something that actually changes a pin
  // or its popup changes — the itinerary selection, check-in state, or user —
  // NOT on location updates. CheckInButton reads live coords from context
  // itself, so the open popup still updates without rebuilding the cluster.
  // Plot EVERY landmark, in every city, all the time — clustering keeps the map
  // uncluttered (world view shows a few number bubbles; zoom into a city and
  // they break apart into individual pins). This lets you zoom out, spot a city,
  // and zoom in to its landmarks even when you're on another continent.
  const markers = useMemo(
    () =>
      ALL_LANDMARKS.filter(passesFilter).map((l) => {
        // Admin Mode's live edit, if any -- id/regionId/lat/lng never
        // change this way (position is savedOverrides' job, just below),
        // only the display fields (name/category/summary/etc).
        const landmark = applyEdit(l);
        const isSelected = getRegionSelection(l.regionId).includes(l.id);
        const region = getRegion(l.regionId);
        const isClaimed = !!claimedMap[l.id];
        const goToDetails = () => navigate(`/landmarks/${l.regionId}/${l.id}`);
        const savedPos = savedOverrides[`${l.regionId}/${l.id}`];
        const position = savedPos ? [savedPos.lat, savedPos.lng] : [l.lat, l.lng];
        return (
          <Marker
            key={`${l.regionId}/${l.id}`}
            position={position}
            icon={pinIcon(isClaimed, isSelected)}
            draggable={adminMode}
            eventHandlers={adminMode ? { dragend: (e) => handlePinDragEnd(l, e) } : undefined}
          >
            <Popup>
              <div className="map-popup">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={goToDetails}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      goToDetails();
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                  title="Tap for details"
                >
                  <LandmarkThumb landmark={landmark} width={228} height={110} myPhoto={myPhotos[l.id]?.[0]} />
                </div>
                <div className="quick-rate-row" style={{ marginTop: 8 }}>
                  <h4 style={{ margin: 0 }}>{landmark.name}</h4>
                  <QuickRateButton landmark={landmark} />
                </div>
                <p style={{ margin: '2px 0 8px', fontSize: '0.72rem', color: 'var(--color-parchment-dim)' }}>
                  {region?.name}
                </p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 0 8px' }}>
                  {landmark.categories.map((c) => (
                    <span key={c} className="tag">
                      {CATEGORY_LABEL[c]}
                    </span>
                  ))}
                  <span className={`tag ${landmark.free ? 'tag-free' : ''}`}>{landmark.free ? 'Free' : 'Ticketed'}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${isSelected ? 'btn-success' : 'btn-primary'}`}
                    onClick={() => handleAdd(landmark)}
                  >
                    {isSelected ? '✓ Added to Itinerary' : 'Add to Itinerary'}
                  </button>
                  <DirectionsButton name={landmark.name} lat={position[0]} lng={position[1]} className="btn btn-ghost btn-sm">
                    {'\u{1F9ED}'} Directions
                  </DirectionsButton>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={goToDetails}>
                    Details
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  <CheckInButton
                    landmark={landmark}
                    user={user}
                    firebaseEnabled={firebaseEnabled}
                    claimedMap={claimedMap}
                    checkingIn={checkingIn}
                    onCheckIn={checkIn}
                    className="btn-block"
                  />
                </div>
              </div>
            </Popup>
          </Marker>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps -- passesFilter only reads filterCats
    [trip.byRegion, claimedMap, checkingIn, user, firebaseEnabled, savedOverrides, filterCats, adminMode, applyEdit]
  );

  // Admin Mode's pin-move for a custom landmark -- separate from the
  // built-in drag-to-fix above (that one writes to landmark_overrides
  // instead). This writes straight onto the custom landmark's own doc,
  // admin-only per firestore.rules just like the built-in one is.
  const handleCustomPinDragEnd = (l, e) => {
    const { lat, lng } = e.target.getLatLng();
    runOptimistic({
      apply: () => setCustomLandmarks((prev) => prev.map((x) => (x.docId === l.docId ? { ...x, lat, lng } : x))),
      commit: () => updateCustomLandmark(l.docId, { lat, lng }),
      // Revert this one pin on failure -- everything else stays as-is.
      rollback: () =>
        setCustomLandmarks((prev) => prev.map((x) => (x.docId === l.docId ? { ...x, lat: l.lat, lng: l.lng } : x))),
      toast,
      errorMessage: `Couldn't move ${l.name}, so it's back where it was.`,
    });
  };

  const customMarkers = useMemo(
    () =>
      customLandmarks.filter(passesFilter).map((l) => {
        const region = getRegion(l.region);
        // Same shape as a built-in landmark (regionId, categories/free
        // defaulted) so this popup can be the exact same one `markers`
        // renders below -- a custom landmark deserves the full card
        // (photo, category tags, Add to Itinerary, Details, Check In),
        // not a stripped-down one just for living in Firestore instead of
        // the static catalog. Still needs both regionId (claimCheckIn/
        // leaderboard) and region (submitReview's review doc) -- omitting
        // the latter used to write `region: undefined` into the review,
        // which the Firestore SDK rejects client-side.
        const landmark = {
          ...l,
          regionId: l.region,
          categories: l.categories || [],
          images: l.images || [],
          facts: l.facts || [],
          free: l.free ?? true,
        };
        const isSelected = getRegionSelection(l.region).includes(l.id);
        const isClaimed = !!claimedMap[l.id];
        const goToDetails = () => navigate(`/landmarks/${l.region}/${l.id}`);
        return (
          <Marker
            key={l.docId}
            position={[l.lat, l.lng]}
            icon={pinIcon(isClaimed, isSelected)}
            draggable={adminMode}
            eventHandlers={adminMode ? { dragend: (e) => handleCustomPinDragEnd(l, e) } : undefined}
          >
            <Popup>
              <div className="map-popup">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={goToDetails}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      goToDetails();
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                  title="Tap for details"
                >
                  <LandmarkThumb landmark={landmark} width={228} height={110} myPhoto={myPhotos[l.id]?.[0]} />
                </div>
                <div className="quick-rate-row" style={{ marginTop: 8 }}>
                  <h4 style={{ margin: 0 }}>{l.name}</h4>
                  <QuickRateButton landmark={landmark} />
                </div>
                <p style={{ margin: '2px 0 8px', fontSize: '0.72rem', color: 'var(--color-parchment-dim)' }}>
                  {region?.name || 'Custom pin'}
                </p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 0 8px' }}>
                  {landmark.categories.map((c) => (
                    <span key={c} className="tag">
                      {CATEGORY_LABEL[c]}
                    </span>
                  ))}
                  <span className={`tag ${landmark.free ? 'tag-free' : ''}`}>{landmark.free ? 'Free' : 'Ticketed'}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {/* A pin far from every curated city has no city itinerary to join. */}
                  {getRegion(l.region) && (
                    <button
                      type="button"
                      className={`btn btn-sm ${isSelected ? 'btn-success' : 'btn-primary'}`}
                      onClick={() => handleAdd(landmark)}
                    >
                      {isSelected ? '✓ Added to Itinerary' : 'Add to Itinerary'}
                    </button>
                  )}
                  <DirectionsButton name={l.name} lat={l.lat} lng={l.lng} className="btn btn-ghost btn-sm">
                    {'\u{1F9ED}'} Directions
                  </DirectionsButton>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={goToDetails}>
                    Details
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  <CheckInButton
                    landmark={landmark}
                    user={user}
                    firebaseEnabled={firebaseEnabled}
                    claimedMap={claimedMap}
                    checkingIn={checkingIn}
                    onCheckIn={checkIn}
                    className="btn-block"
                  />
                </div>
                {user && (l.createdBy === user.uid || (isAdmin(user.email) && adminMode)) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-block"
                    style={{ marginTop: 8 }}
                    onClick={() => removeCustomLandmark(l.docId)}
                  >
                    {'\u{1F5D1}'} Remove Pin
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- passesFilter only reads filterCats
    [customLandmarks, claimedMap, checkingIn, user, firebaseEnabled, checkIn, navigate, filterCats, myPhotos, getRegionSelection, adminMode]
  );

  const picksReady = !!user && !!myReviewsLoaded;
  const showPicks = picksReady && !nav && !tripRoute && !placingPin && !searchOpen && !filterOpen;
  const picksH = picksMinimized ? PICKS_SHEET_H.minimized : PICKS_SHEET_H.collapsed;

  return (
    <div
      className={`map-fullscreen ${showPicks ? 'has-picks' : ''}`}
      style={showPicks ? { '--map-picks-h': `${picksH}px` } : undefined}
    >
      <OnboardingBanner variant="fixed" />
      {/* A small note, not a cover: the map and its pins are usable while
          the GPS fix is still coming in. */}
      {geoLoading && (
        <div className="map-locating-pill" role="status">
          <span className="map-loading-pulse" />
          Finding your location…
        </div>
      )}

      <MapContainer
          ref={mapRef}
          center={[20, 0]}
          zoom={2}
          zoomSnap={0.25}
          zoomDelta={0.25}
          zoomControl={false}
          attributionControl={false}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <InitialView
            coords={coords}
            lastKnown={lastKnown}
            bounds={ALL_LANDMARKS_BOUNDS}
            regionBounds={regionBounds}
            stopBounds={stopBounds}
            focusPoint={focusLandmarkPos}
            radiusMiles={radiusMiles}
          />
          {!placingPin && <LocateControl coords={coords} radiusMiles={radiusMiles} />}
          <AttributionControl position="bottomright" prefix={false} />
          <PinDropHandler onDrop={setPinDrop} disabled={placingPin} />
          <TileLayer
            key={satellite ? 'satellite' : 'street'}
            attribution={TILE_LAYERS[satellite ? 'satellite' : 'street'].attribution}
            url={TILE_LAYERS[satellite ? 'satellite' : 'street'].url}
          />
          {/* Transparent labels overlay on top of the satellite imagery: country
              names when zoomed out, cities mid-zoom, neighborhoods/streets up
              close — so you can orient without leaving the satellite view. */}
          {satellite && (
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              attribution="&copy; Esri"
              zIndex={650}
            />
          )}
          {orderedTrip && !nav && (
            <>
              <FitTripRoute
                points={[...(orderedTrip.origin ? [[orderedTrip.origin.lat, orderedTrip.origin.lng]] : []), ...orderedTrip.stops.map((st) => [st.lat, st.lng])]}
              />
              <Polyline
                positions={[...(orderedTrip.origin ? [[orderedTrip.origin.lat, orderedTrip.origin.lng]] : []), ...orderedTrip.stops.map((st) => [st.lat, st.lng])]}
                pathOptions={{ color: '#4d7fff', weight: 4, opacity: 0.9, dashArray: '8 8' }}
              />
              {orderedTrip.stops.map((st, i) => (
                <Marker key={`trip-${st.id || i}`} position={[st.lat, st.lng]} icon={tripStopIcon(i + 1)} zIndexOffset={900}>
                  <Tooltip direction="top" offset={[0, -14]} className="focus-tooltip">
                    {i + 1}. {st.name}
                  </Tooltip>
                </Marker>
              ))}
            </>
          )}
          {navActive && <FollowUser pos={coords} following={following} onUserPan={() => setFollowing(false)} />}
          {nav?.data?.points?.length > 1 && (
            <>
              {!navActive && <FitNavRoute points={nav.data.points} />}
              <Polyline positions={remainingPoints} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.6 }} />
              {/* Green once real turn-by-turn is up: this is THE way,
                  distinct from the plain blue used for a planned-but-not-
                  navigating route elsewhere in the app. The rest of the map
                  dims (body.map-nav-open, in theme.css) so it stands out --
                  the underlying satellite imagery has no real per-road data
                  we could recolor individually, only what we draw ourselves. */}
              <Polyline positions={remainingPoints} pathOptions={{ color: NAV_ROUTE_GREEN, weight: 5, opacity: 1 }} />
              <Marker position={[nav.dest.lat, nav.dest.lng]} icon={focusIcon} zIndexOffset={1000} interactive={false}>
                <Tooltip permanent direction="top" offset={[0, -34]} className="focus-tooltip">
                  {nav.dest.name}
                </Tooltip>
              </Marker>
            </>
          )}
          {coords && (
            <Marker position={[coords.lat, coords.lng]} icon={userIcon}>
              <Popup>You are here</Popup>
            </Marker>
          )}
          {/* Both highlight pins sit on top of the real landmark marker at the
              same spot. interactive={false} gives them pointer-events: none, so
              a tap falls through to the real pin and opens its popup -- without
              it the highlight swallowed the tap and nothing happened. */}
          {focusLandmarkPos && (
            <Marker
              position={[focusLandmarkPos.lat, focusLandmarkPos.lng]}
              icon={focusIcon}
              zIndexOffset={1000}
              interactive={false}
            >
              {focusLandmarkPos.name && (
                <Tooltip permanent direction="top" offset={[0, -34]} className="focus-tooltip">
                  {focusLandmarkPos.name}
                </Tooltip>
              )}
            </Marker>
          )}
          {searchFocus && (
            <Marker
              position={[searchFocus.lat, searchFocus.lng]}
              icon={focusIcon}
              zIndexOffset={1000}
              interactive={false}
            >
              <Tooltip permanent direction="top" offset={[0, -34]} className="focus-tooltip">
                {searchFocus.name}
              </Tooltip>
            </Marker>
          )}
          {pinDrop && (
            <Marker
              position={[pinDrop.lat, pinDrop.lng]}
              icon={focusIcon}
              zIndexOffset={1000}
              eventHandlers={{
                add: (e) => e.target.openPopup(),
                popupclose: () => setPinDrop(null),
              }}
            >
              <Popup>
                <div className="map-popup">
                  <h4 style={{ marginTop: 0 }}>Add a landmark here?</h4>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => navigate('/add-landmark', { state: pinDrop })}
                    >
                      {'\u{2795}'} Add Landmark
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPinDrop(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              </Popup>
            </Marker>
          )}
          <MarkerClusterGroup
            chunkedLoading
            maxClusterRadius={55}
            spiderfyOnMaxZoom
            iconCreateFunction={clusterIcon}
          >
            {markers}
            {customMarkers}
          </MarkerClusterGroup>
        </MapContainer>

      {orderedTrip && !nav && (
        <div className="map-nav-sheet">
          <div className="card turn-panel trip-route-panel">
            <div className="turn-panel-head">
              <h3 style={{ margin: 0 }}>
                {'\u{1F5FA}\u{FE0F}'} {tripRoute.name}
              </h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTripRoute(null)}>
                {'\u{2715}'} Close
              </button>
            </div>
            <p className="screen-subtitle" style={{ margin: '4px 0 8px' }}>
              {orderedTrip.origin ? 'Best order from where you are' : 'Best order between the stops'} · {orderedTrip.stops.length}{' '}
              stop{orderedTrip.stops.length === 1 ? '' : 's'}
            </p>
            <ol className="turn-steps trip-route-steps">
              {orderedTrip.stops.map((st, i) => (
                <li key={st.id || i}>
                  <span>
                    {i + 1}. {st.name}
                  </span>
                  {(i > 0 || orderedTrip.origin) && (
                    <span className="turn-step-dist">{formatDistance(st.distanceFromPrevMeters, units)}</span>
                  )}
                </li>
              ))}
            </ol>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={startTripRoute} disabled={!coords}>
                {'\u{25B6}\u{FE0F}'} {coords ? 'Start' : 'Start (waiting for location)'}
              </button>
              {googleMapsMultiStopLegs(orderedTrip.stops, orderedTrip.origin).map((href, i, all) => (
                <a key={href} className="btn btn-ghost btn-sm" href={href} target="_blank" rel="noreferrer">
                  {all.length > 1 ? `Google Maps, part ${i + 1} of ${all.length}` : 'All stops in Google Maps'}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Live mode takes over the screen; a route that failed to load at
          all falls back to the regular sheet, with its error and Try again. */}
      {nav && navActive && !(nav.error && !nav.data) ? (
        <ActiveNavOverlay
          key={`${nav.dest.lat},${nav.dest.lng}`}
          dest={nav.dest}
          mode={nav.data?.mode}
          progress={progress}
          rerouting={nav.loading && !!nav.data}
          following={following}
          onRecenter={() => setFollowing(true)}
          onEnd={() => setNav(null)}
          nextStop={nav.queue?.[0] || null}
          onNextStop={goToNextStop}
        />
      ) : (
        nav && (
          <div className="map-nav-sheet">
            <TurnByTurnPanel
              stop={nav.dest}
              loading={nav.loading}
              error={nav.error}
              data={nav.data}
              onRefresh={refreshNav}
              onClose={() => setNav(null)}
              onStart={coords ? startLiveNav : null}
            />
          </div>
        )
      )}

      {!placingPin && (
        <>
          <button type="button" className="map-search-btn" title="Search landmarks" onClick={toggleSearch}>
            {searchOpen ? '\u{2715}' : '\u{1F50D}'}
          </button>
          <button
            type="button"
            className="map-search-btn map-add-btn"
            style={{ top: 'calc(var(--header-h) + 64px)' }}
            title="Add a landmark — long-press the map to pin an exact spot"
            onClick={startPlacingPin}
          >
            {'\u{2795}'}
          </button>
          <button
            type="button"
            className={`map-search-btn ${filterCats.size > 0 ? 'active' : ''}`}
            style={{ top: 'calc(var(--header-h) + 128px)' }}
            title="Filter the map by category"
            onClick={() => {
              setFilterOpen((o) => !o);
              setSearchOpen(false);
            }}
          >
            {filterOpen ? '\u{2715}' : '\u{1F5C2}\u{FE0F}'}
          </button>
          {filterCats.size > 0 && !filterOpen && (
            <button type="button" className="map-filter-pill" onClick={() => setFilterCats(new Set())}>
              Showing {filterCats.size} {filterCats.size === 1 ? 'category' : 'categories'} · Show all
            </button>
          )}
          {filterOpen && (
            <div className="map-search-panel">
              <MapCategoryFilter
                selected={filterCats}
                onToggle={toggleFilterCat}
                onClear={() => setFilterCats(new Set())}
              />
            </div>
          )}
          {pinSavedNote ? (
            <p className="tag tag-free map-edit-hint">Saved: {pinSavedNote}</p>
          ) : (
            adminMode && <p className="tag map-edit-hint">Admin Mode: drag any pin to move it — saves for everyone</p>
          )}
          {searchOpen && (
            <div className="map-search-panel">
              <input
                type="search"
                name="map-search"
                aria-label="Search landmarks, states, countries"
                autoComplete="off"
                enterKeyHint="search"
                autoFocus
                className="map-search-input"
                placeholder={'\u{1F50D} Search landmarks, states, countries…'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {!searchTerm.trim() && coords && (
                <div className="map-search-results">
                  <div className="map-search-heading">{'\u{1F4E1}'} Nearby now</div>
                  {nearbyList.length === 0 && <div className="map-search-empty">Nothing nearby yet.</div>}
                  {nearbyList.map((l) => (
                    <button
                      type="button"
                      key={l.id}
                      className="map-search-result"
                      onClick={() => selectSearchResult({ ...l, zoom: 17 })}
                    >
                      <span className="map-search-result-name">{l.name}</span>
                      <span className="map-search-result-city">{formatDistance(l.meters, units)} away</span>
                    </button>
                  ))}
                </div>
              )}
              {searchTerm.trim() && (
                <div className="map-search-results">
                  {searchResults.length === 0 && !smart.loading && smartResults.length === 0 && (
                    <div className="map-search-empty">Nothing matches "{searchTerm}".</div>
                  )}
                  {searchResults.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      className="map-search-result"
                      onClick={() => selectSearchResult(r)}
                    >
                      <span className="map-search-result-name">{r.name}</span>
                      <span className="map-search-result-city">{r.sub}</span>
                    </button>
                  ))}
                  <SmartSearchLabel loading={smart.loading} count={smartResults.length} />
                  {smartResults.map((r) => (
                    <button type="button" key={r.id} className="map-search-result" onClick={() => selectSearchResult(r)}>
                      <span className="map-search-result-name">{r.name}</span>
                      <span className="map-search-result-city">{r.sub}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="map-fab-bar">
            <select className="radius-select" value={radiusOption} onChange={handleRadiusChange} title="Zoom radius">
              {ZOOM_RADIUS_OPTIONS.map((miles) => (
                <option key={miles} value={miles}>
                  {miles} {distanceUnitLabel(units)}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {placingPin && (
        <>
          <div className="map-pin-target" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <line x1="18" y1="1" x2="18" y2="9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="18" y1="27" x2="18" y2="35" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="1" y1="18" x2="9" y2="18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="27" y1="18" x2="35" y2="18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="18" cy="18" r="7" stroke="currentColor" strokeWidth="2.5" />
              <circle cx="18" cy="18" r="2" fill="currentColor" />
            </svg>
          </div>
          <p className="map-pin-target-hint">Pan the map to line up your spot</p>
          <button type="button" className="map-search-btn map-pin-cancel-btn" title="Cancel" onClick={() => setPlacingPin(false)}>
            {'\u{2715}'}
          </button>
          <button type="button" className="btn btn-primary map-pin-done-btn" onClick={confirmPinPlacement}>
            Done
          </button>
        </>
      )}

      {picksReady && (
        <MapPicksOverlay
          hidden={!showPicks}
          coords={coords}
          geoError={geoError}
          overrides={savedOverrides}
          expanded={picksExpanded}
          onExpandedChange={setPicksExpanded}
          minimized={picksMinimized}
          onMinimizedChange={(v) => {
            setPicksMinimized(v);
            if (v) setPicksExpanded(false);
          }}
        />
      )}

      {geoError && <p className="tag tag-error map-error-toast">Location unavailable — {geoError}</p>}
    </div>
  );
}
