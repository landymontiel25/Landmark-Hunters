import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTrip } from '../lib/TripContext';
import { useGeo } from '../lib/GeoContext';
import { useCheckIn } from '../lib/useCheckIn';
import { useFriends } from '../lib/FriendsContext';
import { useMyPhotos } from '../lib/MyPhotosContext';
import CheckInButton from '../components/CheckInButton';
import LandmarkThumb from '../components/LandmarkThumb';
import QuickRateButton from '../components/QuickRateButton';
import TripRecapCard from '../components/TripRecapCard';
import ThemedChallenge from '../components/ThemedChallenge';
import OfflineDownloadButton from '../components/OfflineDownloadButton';
import { createGroupTrip, listMyGroupTrips } from '../lib/groupTrips';
import { itineraryPhase, groupKey } from '../lib/itineraryStatus';
import { getRegion } from '../data/regions';
import { getCustomLandmarks } from '../lib/customLandmarks';
import { geocodeLocation } from '../lib/geocode';
import { useStopAddresses } from '../lib/useStopAddresses';
import { distanceMeters } from '../lib/geo';
import { matchesSearch } from '../lib/search';
import {
  orderStops,
  annotateRoute,
  enhanceRouteWithDrivingTimes,
  fetchDirections,
  googleMapsMultiStopLegs,
} from '../lib/routing';
import TurnByTurnPanel from '../components/TurnByTurnPanel';
import DirectionsButton from '../components/DirectionsButton';
import AdmissionTag from '../components/AdmissionTag';
import { useRatings } from '../lib/RatingsContext';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { usePersistentState } from '../lib/usePersistentState';
import { useDragReorder } from '../lib/useDragReorder';
import { friendlyError } from '../lib/friendlyError';
import { useToast } from '../lib/ToastContext';
import ErrorNotice from '../components/ErrorNotice';
import AddMemberSheet from '../components/AddMemberSheet';
import EditableTitle from '../components/EditableTitle';
import { ScreenSkeleton, Skeleton, SkeletonCard, SkeletonList } from '../components/Skeleton';

const ROUTE_BLUE = '#2b7fff';
// Turn-by-turn's actual route, once directions are up -- distinct from the
// plain blue planned-order line, which is just a preview, not live
// directions. The map itself dims around it (.itinerary-map.navigating in
// theme.css) so it stands out; the satellite imagery has no per-road data
// we could recolor individually, only what we draw ourselves.
const NAV_ROUTE_GREEN = '#22c55e';

// Setup used to be its own bottom-nav tab; it's now this modal, opened from
// here instead -- "Create New Trip" is the only place it's reachable from.
const TripSetup = lazy(() => import('./TripSetup'));

function CreateTripModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="btn btn-ghost btn-block" style={{ marginBottom: 12 }} onClick={onClose}>
          {'\u{2715}'} Close
        </button>
        <Suspense fallback={<ScreenSkeleton label="Loading trip setup" />}>
          <TripSetup />
        </Suspense>
      </div>
    </div>
  );
}

// Satellite basemap (matches the Explore map's default look).
const SAT_TILE = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
};

const LABELS_TILE = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Place labels &copy; Esri',
};

const startIcon = L.divIcon({
  className: '',
  html: '<div class="route-map-start">START</div>',
  iconSize: [46, 22],
  iconAnchor: [23, 11],
});

function numberedIcon(n) {
  return L.divIcon({
    className: '',
    html: `<div class="route-map-num">${n}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16],
  });
}

// Fit the map to show the whole route (origin + every stop) once it's ready.
function FitRoute({ points }) {
  const map = useMap();
  useEffect(() => {
    const id = requestAnimationFrame(() => map.invalidateSize());
    return () => cancelAnimationFrame(id);
  }, [map]);
  useEffect(() => {
    if (points.length === 1) {
      map.setView(points[0], 13);
    } else if (points.length > 1) {
      map.fitBounds(points, { padding: [40, 40] });
    }
  }, [map, points]);
  return null;
}

function ItineraryMap({ origin, stops, onDetails, onInApp, navPoints, navStopId, me }) {
  // Only put the START point on the map when it's actually near the city you're
  // viewing (same metro). If you're 1,000 miles away, including it would draw a
  // long line across states and zoom the map out to the whole coast — so we drop
  // it and just show the city's stops.
  const nearestStopKm =
    origin && stops.length
      ? Math.min(...stops.map((s) => distanceMeters(origin.lat, origin.lng, s.lat, s.lng))) / 1000
      : Infinity;
  const showOrigin = !!origin && nearestStopKm <= 80; // ~50 miles

  const linePoints = [
    ...(showOrigin ? [[origin.lat, origin.lng]] : []),
    ...stops.map((s) => [s.lat, s.lng]),
  ];

  const navigating = navPoints?.length > 1;

  return (
    <div className={`itinerary-map ${navigating ? 'navigating' : ''}`}>
      <MapContainer center={linePoints[0] || [25.77, -80.19]} zoom={12} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <FitRoute points={navigating ? navPoints : linePoints} />
        <TileLayer url={SAT_TILE.url} attribution={SAT_TILE.attribution} />
        {/* Transparent labels overlay, same as the Explore map: country names
            zoomed out, neighborhoods/streets up close, without leaving satellite. */}
        <TileLayer url={LABELS_TILE.url} attribution={LABELS_TILE.attribution} zIndex={650} />

        {/* White casing under the blue line for contrast on satellite imagery */}
        {/* While showing directions, the stop-to-stop outline fades to a
            dashed hint and the real road route takes over. */}
        {linePoints.length > 1 &&
          (navigating ? (
            <Polyline positions={linePoints} pathOptions={{ color: '#ffffff', weight: 2, opacity: 0.45, dashArray: '6 8' }} />
          ) : (
            <>
              <Polyline positions={linePoints} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.55 }} />
              <Polyline positions={linePoints} pathOptions={{ color: ROUTE_BLUE, weight: 4, opacity: 0.95 }} />
            </>
          ))}

        {navigating && (
          <>
            <Polyline positions={navPoints} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.6 }} />
            <Polyline positions={navPoints} pathOptions={{ color: NAV_ROUTE_GREEN, weight: 5, opacity: 1 }} />
          </>
        )}

        {navigating && me && (
          <CircleMarker
            center={[me.lat, me.lng]}
            radius={8}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: ROUTE_BLUE, fillOpacity: 1 }}
          />
        )}

        {showOrigin && (
          <Marker position={[origin.lat, origin.lng]} icon={startIcon}>
            <Popup>Your starting point</Popup>
          </Marker>
        )}

        {stops.map((s, idx) => (
          <Marker
            key={s.id}
            position={[s.lat, s.lng]}
            icon={numberedIcon(idx + 1)}
            opacity={navigating && s.id !== navStopId ? 0.55 : 1}
          >
            <Popup>
              <div className="map-popup">
                <h4>
                  {idx + 1}. {s.name}
                </h4>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <DirectionsButton
                    name={s.name}
                    lat={s.lat}
                    lng={s.lng}
                    className="btn btn-primary btn-sm"
                    onInApp={onInApp ? () => onInApp(s) : undefined}
                  >
                    {'\u{1F9ED}'} Get Directions
                  </DirectionsButton>
                  {onDetails && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDetails(s)}>
                      Details
                    </button>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

// How far you need to actually move before we re-route off your live GPS.
// watchPosition fires on every tiny jitter; without this, each tick would
// re-trigger the OSRM driving-time lookups for no real change in the route.
const AUTO_ORIGIN_REFRESH_METERS = 150;

export default function Itinerary() {
  const {
    trip,
    toggleLandmark,
    setRegionSelection,
    getRegionSelection,
    regionsWithItineraries,
    updateTrip,
    setMapFocus,
    setMapFocusStops,
    itineraryName,
    renameItinerary,
    removePlace,
    removeItinerary,
    addPlace,
    setItineraryStatus,
    reorderLandmarks,
  } = useTrip();
  const [showAddMember, setShowAddMember] = useState(false);
  const { coords } = useGeo();
  const { user, firebaseEnabled, claimedMap, checkingIn, checkIn } = useCheckIn();
  const { myUsername } = useFriends();
  const { units } = useUnits();
  const { myPhotos } = useMyPhotos();
  const navigate = useNavigate();
  const toast = useToast();

  // One itinerary per city. Overview lists them; opening one shows its route.
  // The open city is remembered, so closing the app mid-trip reopens that
  // city's route instead of the overview.
  // A saved city id the catalog no longer knows can't be shown (or opened).
  const myRegions = regionsWithItineraries().filter((rid) => getRegion(rid));
  const [openRegion, setOpenRegion] = usePersistentState('itinerary.openRegion', null);
  const [showCreateTrip, setShowCreateTrip] = useState(false);
  const openReg = openRegion && myRegions.includes(openRegion) ? openRegion : null;
  const region = getRegion(openReg);

  // Opening a city's itinerary makes it the active city, so tapping Map lands
  // on this city (not on whatever you looked at last).
  useEffect(() => {
    if (openReg) {
      updateTrip({ activeRegion: openReg });
      setMapFocus(openReg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openReg]);

  const [origin, setOrigin] = useState(null);
  const [geocoding, setGeocoding] = useState(true);
  const [view, setView] = useState('list'); // 'list' | 'map'
  const { ratings } = useRatings();
  // No sort preference to remember until the traveler has actually used
  // "Edit List" once -- until then the route is just always nearest-to-me,
  // automatically, with nothing to pick. Once they've edited it, this
  // remembers whether they want to see that custom order or fall back to
  // nearest, per city.
  const [sortPref, setSortPref] = usePersistentState(region ? `itin-sort-pref.${region.id}` : null, null);
  // Local, not persisted -- always starts closed when you open an itinerary.
  const [editing, setEditing] = useState(false);
  const sort = editing ? 'custom' : sortPref || 'nearest';
  const [pendingRemove, setPendingRemove] = useState(null); // stop awaiting delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRecap, setShowRecap] = useState(false);
  const [groupTrips, setGroupTrips] = useState([]);
  // Kept apart from "no group trips": a failed load must not look like
  // (or fall through to) the empty "No itineraries yet" screen.
  const [groupsLoading, setGroupsLoading] = useState(!!user);
  const [groupsError, setGroupsError] = useState(null);

  const loadGroupTrips = () => {
    if (!user) {
      setGroupsLoading(false);
      return;
    }
    setGroupsLoading(true);
    setGroupsError(null);
    listMyGroupTrips(user.uid)
      .then(setGroupTrips)
      .catch(setGroupsError)
      .finally(() => setGroupsLoading(false));
  };
  useEffect(() => {
    loadGroupTrips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  const autoOriginRef = useRef(null);

  const confirmRemove = () => {
    if (pendingRemove && region) {
      if (pendingRemove.external) removePlace(region.id, pendingRemove.id);
      else toggleLandmark(pendingRemove.id, region.id);
    }
    setPendingRemove(null);
  };

  const [customLms, setCustomLms] = useState([]);
  useEffect(() => {
    getCustomLandmarks().then(setCustomLms).catch(() => {});
  }, []);

  // Catalog landmarks plus any real places Mapr found on the web and you
  // added -- those get a landmark-shaped stand-in so the route, map and
  // directions treat them the same (no check-in or rating: they aren't in
  // the catalog, so there's nothing to award points for).
  const selectedLandmarks = useMemo(() => {
    if (!region) return [];
    const ids = trip.byRegion[region.id] || [];
    // User-submitted landmarks in this city (not in region.landmarks) --
    // without these, adding one to the itinerary made it silently vanish.
    const customs = customLms
      .filter((l) => l.region === region.id && ids.includes(l.id))
      .map((l) => ({
        ...l,
        regionId: region.id,
        categories: l.categories || [],
        images: l.images || [],
        facts: l.facts || [],
        free: l.free ?? true,
        typicalMinutes: l.typicalMinutes ?? 15,
      }));
    const places = (trip.placesByRegion?.[region.id] || []).map((p) => ({
      ...p,
      external: true,
      regionId: region.id,
      categories: [],
      images: [],
      free: true,
      typicalMinutes: 45,
    }));
    return [...region.landmarks.filter((l) => ids.includes(l.id)), ...customs, ...places];
  }, [region, trip.byRegion, trip.placesByRegion, customLms]);

  // Tapping Map from here frames every stop in this itinerary. Declared
  // after the effect above that calls setMapFocus (which clears it).
  useEffect(() => {
    const pts = selectedLandmarks.filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng)).map((l) => ({ lat: l.lat, lng: l.lng }));
    setMapFocusStops(openReg && pts.length ? pts : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openReg, selectedLandmarks]);

  // Adding someone to a solo itinerary turns it into a group trip: same
  // name, stops and places, you as owner, them as a member.
  const [converting, setConverting] = useState(false);
  const convertToGroup = async (member) => {
    if (!user || !region || converting) return;
    setConverting(true);
    try {
      const id = await createGroupTrip({
        ownerUid: user.uid,
        ownerName: myUsername || user.displayName || 'Explorer',
        name: itineraryName(region.id),
        regionId: region.id,
        landmarkIds: selectedLandmarks.filter((l) => !l.external).map((l) => l.id),
        places: (trip.placesByRegion?.[region.id] || []).map(({ id: pid, name, address, lat, lng, url }) => ({
          id: pid,
          name,
          address: address || '',
          lat,
          lng,
          url: url || '',
        })),
        initialMembers: [member],
      });
      removeItinerary(region.id);
      setShowAddMember(false);
      setOpenRegion(null);
      toast.show(`${member.name} is on it now. It's a group trip you both can edit.`, { tone: 'success', durationMs: 4000 });
      navigate(`/group/${id}`);
    } catch (e) {
      toast.show(friendlyError(e, `Couldn't add ${member.name}. Try again.`), {
        actionLabel: 'Retry',
        onAction: () => convertToGroup(member),
      });
    } finally {
      setConverting(false);
    }
  };

  // Priority for the route's starting point: an explicit pin (autocomplete
  // selection or "Use My Current Location") > a typed address to geocode >
  // your live GPS, refreshed only once you've actually moved > the region's
  // center as a last resort before any of that is available. No starting
  // location is required — landmarks you've added always show a route.
  useEffect(() => {
    let cancelled = false;

    if (!region) {
      setGeocoding(false);
      return;
    }

    if (trip.startingCoords) {
      setOrigin(trip.startingCoords);
      setGeocoding(false);
      return;
    }

    if (trip.startingLocation) {
      setGeocoding(true);
      geocodeLocation(trip.startingLocation, region)
        .catch(() => null)
        .then((geocoded) => {
          if (!cancelled) {
            setOrigin(geocoded || region.center);
            setGeocoding(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    const fallback = coords || region.center;
    const last = autoOriginRef.current;
    const moved = !last || distanceMeters(last.lat, last.lng, fallback.lat, fallback.lng) > AUTO_ORIGIN_REFRESH_METERS;
    if (moved) {
      autoOriginRef.current = fallback;
      setOrigin(fallback);
    }
    setGeocoding(false);
  }, [region, trip.startingLocation, trip.startingCoords, coords]);

  // The visit order comes from the "Sort by" pick, measured from your LIVE
  // location (falling back to the saved start point). Default is nearest to
  // you first, so the list -- and the map route, which follows the same
  // order -- runs closest to farthest. Every stop then gets its leg from the
  // stop before it, so "X to next stop" and the drawn route
  // hold for whichever sort is picked.
  // Quantize to ~100m so the order/route only recomputes when you actually move,
  // not on every GPS jitter (which made the screen flicker and re-sort).
  const liveOrigin = coords || origin;
  const originKey = liveOrigin ? `${liveOrigin.lat.toFixed(3)},${liveOrigin.lng.toFixed(3)}` : 'none';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const routeOrigin = useMemo(() => liveOrigin, [originKey]);

  // The persisted drag order IS byRegion's own array order (see
  // reorderLandmarks in TripContext.jsx) -- no separate order field to keep in sync.
  const customOrder = (region && trip.byRegion[region.id]) || [];
  const route = useMemo(() => {
    if (!routeOrigin || !selectedLandmarks.length) return [];
    return annotateRoute(routeOrigin, orderStops(sort, routeOrigin, selectedLandmarks, ratings, customOrder));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeOrigin, selectedLandmarks, sort, ratings, customOrder.join(',')]);

  const [drivingRoute, setDrivingRoute] = useState([]);

  useEffect(() => {
    if (!routeOrigin || !route.length) {
      setDrivingRoute([]);
      return;
    }
    let cancelled = false;
    // Driving times only refine the straight-line estimates already on
    // screen; if the lookup fails, those estimates simply stay.
    enhanceRouteWithDrivingTimes(routeOrigin, route)
      .catch(() => route)
      .then((enhanced) => {
        if (!cancelled) {
          setDrivingRoute(enhanced);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [routeOrigin, route]);

  const displayRoute = drivingRoute.length === route.length ? drivingRoute : route;

  // Hold-and-drag reorder (the grip on each stop card), only offered while
  // "Sort by" is "My order" -- dragging while sorted by distance/rating/etc.
  // would just fight that sort right back.
  const stopsById = useMemo(() => Object.fromEntries(displayRoute.map((s) => [s.id, s])), [displayRoute]);
  const stopIds = useMemo(() => displayRoute.map((s) => s.id), [displayRoute]);
  const { order: dragOrder, registerNode, startDrag, keyReorder, draggingId, dragY, shifts } = useDragReorder(stopIds, (newIds) => {
    if (region) reorderLandmarks(region.id, newIds);
  });
  const orderedRoute = dragOrder.map((id) => stopsById[id]).filter(Boolean);

  // Street address under each catalog stop (Mapr-found places already have one).
  const addresses = useStopAddresses(selectedLandmarks);

  // Deletes this city's itinerary (stops, Mapr places, name) with an Undo.
  const deleteItinerary = () => {
    const rid = region.id;
    const name = itineraryName(rid);
    const landmarks = [...(trip.byRegion[rid] || [])];
    const places = [...(trip.placesByRegion?.[rid] || [])];
    const customName = trip.itineraryNames?.[rid] || '';
    removeItinerary(rid);
    setConfirmDelete(false);
    setOpenRegion(null);
    toast.show(`Deleted ${name}.`, {
      actionLabel: 'Undo',
      onAction: () => {
        if (landmarks.length) setRegionSelection(rid, landmarks);
        places.forEach((pl) => addPlace(rid, pl));
        if (customName) renameItinerary(rid, customName);
        setOpenRegion(rid);
      },
    });
  };

  // Live navigation on the full-screen Map through the stops still to go,
  // in list order; each arrival offers the next one.
  const toNavStop = (s) => ({ name: s.name, lat: s.lat, lng: s.lng });
  const startTrip = (fromStop) => {
    const pending = displayRoute.filter((s) => !claimedMap[s.id]);
    const list = fromStop
      ? displayRoute.slice(displayRoute.findIndex((s) => s.id === fromStop.id)).filter((s) => s.id === fromStop.id || !claimedMap[s.id])
      : pending.length
      ? pending
      : displayRoute;
    if (!list.length) return;
    navigate('/', {
      state: { directionsTo: toNavStop(list[0]), directionsQueue: list.slice(1).map(toNavStop), startNav: true },
    });
  };
  const linkStops = displayRoute.filter((s) => !claimedMap[s.id]).length
    ? displayRoute.filter((s) => !claimedMap[s.id])
    : displayRoute;
  const allWalkable = linkStops.every((s, i) => i === 0 || s.distanceFromPrevMeters <= 1200);
  const allStopsLinks = googleMapsMultiStopLegs(linkStops, coords, allWalkable ? 'walking' : 'driving');

  // In-app turn-by-turn (api/directions.js). Starts from your live GPS when
  // you're actually in the city; if you're planning from far away, from the
  // stop before this one instead, so the route is still the useful leg.
  const [nav, setNav] = useState(null); // { stop, loading, error, data }
  const mapRef = useRef(null);
  const startNav = async (stop) => {
    const idx = displayRoute.findIndex((x) => x.id === stop.id);
    const near = (p) => p && distanceMeters(p.lat, p.lng, stop.lat, stop.lng) <= 80000;
    const from = near(coords) ? coords : idx > 0 ? displayRoute[idx - 1] : near(routeOrigin) ? routeOrigin : null;
    setView('map');
    requestAnimationFrame(() => mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    if (!from) {
      setNav({ stop, loading: false, data: null, error: `You're far from ${stop.name} right now. Directions start once you're in town, or pick a later stop to get the leg from the stop before it.` });
      return;
    }
    setNav({ stop, loading: true, error: null, data: null });
    try {
      const data = await fetchDirections(from, stop);
      setNav((cur) => (cur?.stop.id === stop.id ? { ...cur, loading: false, data } : cur));
    } catch (e) {
      const error = friendlyError(e, "Couldn't get directions right now. Try again, or open your maps app.");
      setNav((cur) => (cur?.stop.id === stop.id ? { ...cur, loading: false, error } : cur));
    }
  };
  // Leaving the city's itinerary drops any directions that were open.
  useEffect(() => setNav(null), [openReg]);

  // How many of this city's planned landmarks you've already checked in at.
  const visitedCount = selectedLandmarks.filter((l) => claimedMap[l.id]).length;

  // Current vs Past (src/lib/itineraryStatus.js): done = every catalog
  // landmark checked into, or moved there by hand.
  const [itinTab, setItinTab] = usePersistentState('itinerary.tab', 'current');
  const statusOverrides = trip.itineraryStatus || {};
  // byRegion also holds Mapr-found places' ids once Edit List has saved an
  // order; those aren't catalog stops (no check-in), so they're left out of
  // the done check and the stop count.
  const catalogIdsFor = (rid) => {
    const known = new Set([
      ...(getRegion(rid)?.landmarks || []).map((l) => l.id),
      ...customLms.filter((l) => l.region === rid).map((l) => l.id),
    ]);
    return (trip.byRegion[rid] || []).filter((id) => known.has(id));
  };
  const soloPhase = (rid) => itineraryPhase(rid, catalogIdsFor(rid), claimedMap, statusOverrides);
  const groupPhase = (g) => itineraryPhase(groupKey(g.id), g.landmarkIds, claimedMap, statusOverrides);
  const pastCount = myRegions.filter((rid) => soloPhase(rid) === 'past').length + groupTrips.filter((g) => groupPhase(g) === 'past').length;
  const currentCount = myRegions.length + groupTrips.length - pastCount;
  // Typing a city searches Current and Past together, by itinerary name,
  // city and country, so a 10-city Europe trip is one search away.
  const [itinQuery, setItinQuery] = useState('');
  const searching = itinQuery.trim().length > 0;
  const regionText = (rid) => [getRegion(rid)?.name, getRegion(rid)?.country].join(' ');
  const soloHits = (rid) => matchesSearch(`${itineraryName(rid)} ${regionText(rid)}`, itinQuery);
  const groupHits = (g) => matchesSearch(`${g.name} ${regionText(g.regionId)}`, itinQuery);
  const tabSolo = searching ? myRegions.filter(soloHits) : myRegions.filter((rid) => soloPhase(rid) === itinTab);
  const tabGroups = searching ? groupTrips.filter(groupHits) : groupTrips.filter((g) => groupPhase(g) === itinTab);
  const pastLabel = (key, landmarkIds) =>
    statusOverrides[key] === 'past' ? 'moved to Past' : `\u{2705} all ${(landmarkIds || []).length} visited`;
  const openPhase = openReg ? soloPhase(openReg) : null;

  // Nothing planned on this device yet: wait for (or report a failure of)
  // the group-trip load before deciding this really is a dead end.
  if (myRegions.length === 0 && groupsLoading) {
    return (
      <div>
        <Skeleton width="60%" height={30} radius={10} style={{ marginBottom: 16 }} />
        <SkeletonList count={2} label="Loading your itineraries" />
      </div>
    );
  }
  if (myRegions.length === 0 && groupsError) {
    return (
      <div className="empty-state">
        <ErrorNotice error={groupsError} message={friendlyError(groupsError, "Couldn't load your group trips.")} onRetry={loadGroupTrips} />
        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setShowCreateTrip(true)}>
          {'\u{2795}'} Create New Trip
        </button>
        {showCreateTrip && <CreateTripModal onClose={() => setShowCreateTrip(false)} />}
      </div>
    );
  }

  // No personal itineraries AND no group trips -- true dead end.
  if (myRegions.length === 0 && groupTrips.length === 0) {
    return (
      <div className="empty-state">
        <p>No itineraries yet. Create a trip to start one.</p>
        <button
          className="btn btn-primary"
          onClick={() => navigate('/mapr', { state: { openTripPlanner: true } })}
        >
          {'\u{1F9ED}'} Use Mapr (recommended)
        </button>
        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setShowCreateTrip(true)}>
          {'\u{2795}'} Create New Trip
        </button>
        {showCreateTrip && <CreateTripModal onClose={() => setShowCreateTrip(false)} />}
      </div>
    );
  }

  // Overview: your cities. Tap one to open its route.
  if (!openReg) {
    return (
      <div>
        <h1 className="screen-title">
          <span>{'\u{1F5FA}\u{FE0F}'}</span> Your Itineraries
        </h1>
        {groupsLoading && <SkeletonList count={1} label="Loading group trips" />}
        {groupsError && !groupsLoading && (
          <ErrorNotice
            error={groupsError}
            message={friendlyError(groupsError, "Couldn't load your group trips.")}
            onRetry={loadGroupTrips}
            compact
          />
        )}
        <input
          type="search"
          className="itin-search"
          aria-label="Search your itineraries"
          placeholder={'\u{1F50D} Search your cities'}
          autoComplete="off"
          enterKeyHint="search"
          value={itinQuery}
          onChange={(e) => setItinQuery(e.target.value)}
        />
        {!searching && (
        <div className="tabs" style={{ marginBottom: 14 }}>
          {[
            { id: 'current', label: 'Current', count: currentCount },
            { id: 'past', label: 'Past', count: pastCount },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab-btn ${itinTab === t.id ? 'active' : ''}`} aria-pressed={!!(itinTab === t.id)}
              onClick={() => setItinTab(t.id)}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>
        )}
        {searching && tabGroups.length + tabSolo.length === 0 && (
          <p className="screen-subtitle">No itinerary matches “{itinQuery.trim()}”.</p>
        )}
        {!searching && itinTab === 'past' && tabGroups.length + tabSolo.length > 0 && (
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            Itineraries move here once you've checked into every landmark on them.
          </p>
        )}
        {!searching && tabGroups.length + tabSolo.length === 0 && !groupsLoading && (
          <p className="screen-subtitle">
            {itinTab === 'past'
              ? "Nothing here yet. Once you've checked into every landmark on an itinerary, it moves here."
              : 'No current itineraries. Start one below, or check Past.'}
          </p>
        )}
        {tabGroups.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ margin: '0 0 8px' }}>{'\u{1F465}'} Group Trips</h3>
            {tabGroups.map((t) => (
              <button
                key={t.id}
                type="button"
                className="card itin-city-card"
                onClick={() => navigate(`/group/${t.id}`)}
              >
                <div style={{ textAlign: 'left' }}>
                  <h3 style={{ margin: 0 }}>{t.name}</h3>
                  <p style={{ margin: '4px 0 0', color: 'var(--color-parchment-dim)', fontSize: '0.85rem' }}>
                    {getRegion(t.regionId)?.name} · {(t.memberUids || []).length} member{(t.memberUids || []).length !== 1 ? 's' : ''}
                    {groupPhase(t) === 'past' ? ` · ${pastLabel(groupKey(t.id), t.landmarkIds)}` : ''}
                  </p>
                </div>
                <span className="itin-city-arrow">{'→'}</span>
              </button>
            ))}
          </div>
        )}
        {!searching && tabSolo.length > 0 && itinTab === 'current' && (
          <p className="screen-subtitle">
            {tabSolo.length} {tabSolo.length === 1 ? 'itinerary' : 'itineraries'} planned — tap one to see its route.
          </p>
        )}
        {tabSolo.map((rid) => {
          const r = getRegion(rid);
          const count = catalogIdsFor(rid).length + (trip.placesByRegion?.[rid] || []).length;
          const named = itineraryName(rid);
          return (
            <button key={rid} type="button" className="card itin-city-card" onClick={() => setOpenRegion(rid)}>
              <div style={{ textAlign: 'left' }}>
                <h3 style={{ margin: 0 }}>{named}</h3>
                <p style={{ margin: '4px 0 0', color: 'var(--color-parchment-dim)', fontSize: '0.85rem' }}>
                  {named !== r?.name ? `${r?.name} · ` : ''}
                  {count} stop{count !== 1 ? 's' : ''}
                  {soloPhase(rid) === 'past' ? ` · ${pastLabel(rid, catalogIdsFor(rid))}` : ''}
                </p>
              </div>
              <span className="itin-city-arrow">{'→'}</span>
            </button>
          );
        })}
        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 16 }}
          onClick={() => navigate('/mapr', { state: { openTripPlanner: true } })}
        >
          {'\u{1F9ED}'} Use Mapr (recommended)
        </button>
        <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => setShowCreateTrip(true)}>
          {'\u{2795}'} Create New Trip
        </button>
        {showCreateTrip && <CreateTripModal onClose={() => setShowCreateTrip(false)} />}
      </div>
    );
  }

  // Same shape as the route that's about to appear: header, tags, then a
  // card per stop.
  if (geocoding) {
    const stopCount = Math.min(Math.max(selectedLandmarks.length, 1), 4);
    return (
      <div className="skeleton-screen" role="status" aria-live="polite">
        <span className="visually-hidden">Mapping your {region.name} route…</span>
        <Skeleton width={130} height={30} radius={999} style={{ marginBottom: 12 }} />
        <Skeleton width="55%" height={30} radius={10} style={{ marginBottom: 10 }} />
        <Skeleton width="70%" height={14} style={{ marginBottom: 18 }} />
        {Array.from({ length: stopCount }, (_, i) => (
          <SkeletonCard key={i} lines={2} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <button className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={() => setOpenRegion(null)}>
        {'←'} My Itineraries
      </button>
      <EditableTitle
        value={itineraryName(region.id)}
        onSave={(name) => renameItinerary(region.id, name)}
        prefix={<span>{'\u{1F5FA}\u{FE0F}'}</span>}
      />
      <p className="screen-subtitle">
        {itineraryName(region.id) !== region.name ? `${region.name} · ` : ''}
        {sort === 'custom' ? 'My order' : 'Nearest to me'}
        {sort === 'nearest'
          ? ` from ${coords ? 'your current location' : trip.startingLocation || 'your starting point'}`
          : ''}{' '}
        · {displayRoute.length} stop{displayRoute.length === 1 ? '' : 's'}
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <span className="tag">
          {'\u{1F4CD}'} {selectedLandmarks.length} landmark{selectedLandmarks.length !== 1 ? 's' : ''} in {region.name}
        </span>
        <span className="tag">
          {'\u{2705}'} {visitedCount} of {selectedLandmarks.filter((l) => !l.external).length} visited
        </span>
        {visitedCount > 0 && (
          <button type="button" className="btn btn-ghost btn-tight" onClick={() => setShowRecap(true)}>
            {'\u{1F3AC}'} Trip Recap
          </button>
        )}
      </div>

      <ThemedChallenge
        regionId={region.id}
        claimedMap={claimedMap}
        onAddAll={(landmarks) => {
          const current = getRegionSelection(region.id);
          const merged = [...new Set([...current, ...landmarks.map((l) => l.id)])];
          setRegionSelection(region.id, merged);
        }}
      />
      <OfflineDownloadButton region={region} />

      <div className="card section">
        <h3 style={{ marginTop: 0 }}>Members</h3>
        <div className="friend-row">
          <span>{user ? `${myUsername || user.displayName || 'You'} (you)` : 'You'}</span>
        </div>
        {user ? (
          <button type="button" className="member-add-row" onClick={() => setShowAddMember(true)} disabled={converting}>
            {'\u{2795}'} {converting ? 'Adding…' : 'Add a user'}
          </button>
        ) : (
          <p className="screen-subtitle" style={{ margin: '10px 0 0' }}>
            <Link to="/profile">Sign in</Link> to plan this with friends.
          </p>
        )}
        {showAddMember && (
          <AddMemberSheet
            title={`Add someone to ${itineraryName(region.id)}`}
            excludeUids={user ? [user.uid] : []}
            onPick={convertToGroup}
            onClose={() => setShowAddMember(false)}
          />
        )}
      </div>

      {showRecap && (
        <TripRecapCard
          regionName={region.name}
          visitedLandmarks={selectedLandmarks.filter((l) => claimedMap[l.id])}
          onClose={() => setShowRecap(false)}
        />
      )}

      <div className="itin-toolbar">
        <div className="tabs" style={{ margin: 0, flex: 1, maxWidth: 240 }}>
          <button
            type="button"
            className={`tab-btn ${view === 'list' ? 'active' : ''}`} aria-pressed={!!(view === 'list')}
            onClick={() => setView('list')}
          >
            {'\u{1F5D2}\u{FE0F}'} List
          </button>
          <button
            type="button"
            className={`tab-btn ${view === 'map' ? 'active' : ''}`} aria-pressed={!!(view === 'map')}
            onClick={() => setView('map')}
          >
            {'\u{1F5FA}\u{FE0F}'} Map
          </button>
        </div>
        {!editing && sortPref && (
          <label className="itin-sort">
            <span>Sort by</span>
            <select className="radius-select" value={sortPref} onChange={(e) => setSortPref(e.target.value)}>
              <option value="nearest">Nearest to me</option>
              <option value="custom">My order</option>
            </select>
          </label>
        )}
        {selectedLandmarks.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (editing) {
                setSortPref('custom');
                setEditing(false);
              } else {
                reorderLandmarks(region.id, displayRoute.map((s) => s.id));
                setEditing(true);
              }
            }}
          >
            {editing ? `${'\u{2705}'} Done` : `${'✏️'} Edit List`}
          </button>
        )}
      </div>

      {view === 'map' && (
        <div ref={mapRef}>
          <ItineraryMap
            origin={routeOrigin}
            stops={displayRoute}
            onDetails={(s) => (s.external ? s.url && window.open(s.url, '_blank', 'noopener') : navigate(`/landmarks/${region.id}/${s.id}`))}
            onInApp={startNav}
            navPoints={nav?.data?.points}
            navStopId={nav?.stop.id}
            me={coords}
          />
          {nav && (
            <TurnByTurnPanel
              stop={nav.stop}
              loading={nav.loading}
              error={nav.error}
              data={nav.data}
              onRefresh={() => startNav(nav.stop)}
              onClose={() => setNav(null)}
              onStart={() => startTrip(nav.stop)}
            />
          )}
        </div>
      )}

      <div style={{ display: view === 'list' ? 'block' : 'none' }}>
        {selectedLandmarks.length === 0 && (
          <div className="empty-state" style={{ padding: '20px 10px' }}>
            <p style={{ margin: '0 0 12px' }}>No stops yet. Ask Mapr ("add Wynwood Walls to my itinerary") or pick landmarks.</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/landmarks')}>
              {'\u{1F4CD}'} Pick Landmarks
            </button>
          </div>
        )}
        {displayRoute.length > 0 && (
          <div className="itin-trip-actions">
            <button type="button" className="btn btn-primary" onClick={() => startTrip()}>
              {'\u{25B6}\u{FE0F}'} Start Trip
            </button>
            {allStopsLinks.map((href, i) => (
              <a key={href} className="btn btn-ghost" href={href} target="_blank" rel="noreferrer">
                {'\u{1F5FA}\u{FE0F}'} {allStopsLinks.length > 1 ? `Google Maps, part ${i + 1} of ${allStopsLinks.length}` : 'All stops in Google Maps'}
              </a>
            ))}
          </div>
        )}
        {orderedRoute.map((stop, idx) => (
          <div
            key={stop.id}
            ref={registerNode(stop.id)}
            style={{
              transform: `translateY(${draggingId === stop.id ? dragY : shifts[stop.id] || 0}px)`,
              transition: draggingId === stop.id ? 'none' : 'transform 150ms ease',
              position: 'relative',
              zIndex: draggingId === stop.id ? 20 : 1,
            }}
          >
            {(idx > 0 || stop.distanceFromPrevMeters <= 80000) && (
              <div className="route-travel">
                {stop.distanceFromPrevMeters <= 1200 ? '\u{1F6B6}' : '\u{1F697}'} {stop.travelMinutesFromPrev || 1} min ·{' '}
                {formatDistance(stop.distanceFromPrevMeters, units)} {idx === 0 ? 'from you' : 'from the last stop'}
              </div>
            )}
            <div className={`route-step ${draggingId === stop.id ? 'dragging' : ''}`}>
              {sort === 'custom' ? (
                <button
                  type="button"
                  className="remove-dash"
                  title="Remove from itinerary"
                  aria-label={`Remove ${stop.name} from itinerary`}
                  onClick={() => setPendingRemove(stop)}
                >
                  {'−'}
                </button>
              ) : (
                <div className="route-num">{idx + 1}</div>
              )}
              <div className={`card ${claimedMap[stop.id] ? 'visited' : ''}`} style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {stop.external ? (
                      <>
                        <span className="chatlab-stop-globe" aria-hidden="true">
                          {'\u{1F310}'}
                        </span>
                        <h4 style={{ margin: 0, color: 'var(--color-parchment)' }}>{stop.name}</h4>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="route-stop-link"
                        onClick={() => navigate(`/landmarks/${region.id}/${stop.id}`)}
                        title={`Open ${stop.name} — check in, rate, or see details`}
                      >
                        <LandmarkThumb landmark={stop} size={44} myPhoto={myPhotos[stop.id]?.[0]} />
                        <h4 style={{ margin: 0, color: 'var(--color-parchment)' }}>{stop.name}</h4>
                      </button>
                    )}
                    {!stop.external && <QuickRateButton landmark={stop} />}
                  </div>
                  {sort === 'custom' ? (
                    <button
                      type="button"
                      className="drag-handle"
                      title="Hold and drag to reorder"
                      aria-label={`Reorder ${stop.name}: hold and drag, or use the up and down arrow keys`}
                      onPointerDown={startDrag(stop.id)}
                      onKeyDown={keyReorder(stop.id)}
                    >
                      {'☰'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-icon-trash"
                      title="Remove from itinerary"
                      aria-label="Remove from itinerary"
                      onClick={() => setPendingRemove(stop)}
                    >
                      {'\u{1F5D1}\u{FE0F}'}
                    </button>
                  )}
                </div>
                {stop.external ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    <span className="tag place-tag">{'\u{2728}'} Found by Mapr</span>
                    {stop.address && <span className="tag place-tag">{stop.address}</span>}
                  </div>
                ) : (
                  <>
                  {addresses[stop.id] && <p className="route-address">{'\u{1F4CD}'} {addresses[stop.id]}</p>}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    <AdmissionTag landmark={stop} />
                    <span className="tag">{'\u{23F1}\u{FE0F}'} ~{stop.typicalMinutes} min there</span>
                  </div>
                  </>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <DirectionsButton
                    name={stop.name}
                    lat={stop.lat}
                    lng={stop.lng}
                    className="btn btn-ghost btn-sm"
                    onInApp={() => startNav(stop)}
                  >
                    Get Directions
                  </DirectionsButton>
                  {stop.external ? (
                    stop.url && (
                      <a className="btn btn-ghost btn-sm" href={stop.url} target="_blank" rel="noreferrer">
                        Source {'↗'}
                      </a>
                    )
                  ) : stop.free == null && !stop.bookingUrl ? null : stop.free ? (
                    <button className="btn btn-sm" disabled style={{ borderColor: 'var(--color-green)', color: '#bfe0c8' }}>
                      Free to Visit
                    </button>
                  ) : (
                    <a className="btn btn-primary btn-sm" href={stop.bookingUrl || '#'} target="_blank" rel="noreferrer">
                      Book Now
                    </a>
                  )}
                  {!stop.external && (
                  <CheckInButton
                    landmark={stop}
                    user={user}
                    firebaseEnabled={firebaseEnabled}
                    claimedMap={claimedMap}
                    checkingIn={checkingIn}
                    onCheckIn={checkIn}
                  />
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="btn btn-primary btn-block" onClick={() => navigate('/')}>
        {'\u{1F3AF}'} Start Checking In on the Map
      </button>

      <button
        type="button"
        className="btn btn-ghost btn-block"
        style={{ marginTop: 12 }}
        onClick={() => {
          const toPast = openPhase !== 'past';
          setItineraryStatus(region.id, toPast ? 'past' : 'current');
          setItinTab(toPast ? 'past' : 'current');
          setOpenRegion(null);
          toast.show(`Moved ${itineraryName(region.id)} to ${toPast ? 'Past' : 'Current'}.`, { tone: 'success' });
        }}
      >
        {openPhase === 'past' ? `${'\u{21A9}\u{FE0F}'} Move back to Current` : `${'\u{1F4E6}'} Move to Past`}
      </button>

      <button type="button" className="btn btn-danger btn-block" style={{ marginTop: 12 }} onClick={() => setConfirmDelete(true)}>
        {'\u{1F5D1}\u{FE0F}'} Delete Itinerary
      </button>

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{'\u{1F5D1}\u{FE0F}'} Delete this itinerary?</h3>
            <p className="screen-subtitle" style={{ marginTop: 0 }}>
              <strong>{itineraryName(region.id)}</strong> and its {displayRoute.length} stop{displayRoute.length === 1 ? '' : 's'} will
              be removed. Your check-ins and ratings stay.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-ghost btn-block" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
              <button className="btn btn-danger btn-block" onClick={deleteItinerary}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRemove && (
        <div className="modal-backdrop" onClick={() => setPendingRemove(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{'\u{1F5D1}\u{FE0F}'} Remove this stop?</h3>
            <p className="screen-subtitle" style={{ marginTop: 0 }}>
              Take <strong>{pendingRemove.name}</strong> off your {region?.name} itinerary? You can always add it back later.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-ghost btn-block" onClick={() => setPendingRemove(null)}>
                Keep it
              </button>
              <button className="btn btn-danger btn-block" onClick={confirmRemove}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
