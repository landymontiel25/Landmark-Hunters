import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Circle, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCheckIn } from '../lib/useCheckIn';
import { useGeo } from '../lib/GeoContext';
import { useFavorites } from '../lib/FavoritesContext';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { useWhereAmI } from '../lib/useWhereAmI';
import { usePickVotes } from '../lib/usePickVotes';
import { ALL_LANDMARKS, REGIONS } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import { categoryLabel, DISTANCE_OPTIONS_MI, distanceUnitLabel, optionToMiles, pickKey, ratePlacesText, SIMILAR_LIMIT } from '../lib/nearbyPicks';
import { primaryCategory } from '../lib/preferenceChains';
import { placeKinds } from '../lib/placeKinds';
import { useMapPicks } from '../components/nearbyPicks/useMapPicks';
import { useShownEffect } from '../components/nearbyPicks/useShownEffect';
import { PickPhoto } from '../components/nearbyPicks/PickCard';
import DirectionsButton from '../components/DirectionsButton';
import { VOTE_COPY, VOTE_ORDER } from '../components/PickVoteButtons';
import AppleTopBar from './AppleTopBar';
import './AppleUI.css';
import './MapUILab.css';

// Test tab "UI" > Map: the owner's Map screen mockup (2026-11-02), iPhone
// first. The real map (satellite, landmark pins, your location) fills the
// screen; the floating parts sit over it: the Landmark Hunters header with
// your streak and points, where you are, search / add / layers, the picks
// distance and locate buttons, and "Picked for you right now", which drags
// up to a half or full sheet (categories, the Nearby list, Because you
// liked). Picks come from the same pipeline as the Map tab's sheet
// (useMapPicks -> Mapr's shared ranking), logged as test sets, with this
// screen's own remembered distance.
//
// The floating parts are laid out at the mockup's width (393pt) and zoomed
// to the phone's width so they keep the mockup's proportions; the map
// itself is not zoomed, so it pans and pinches normally.

const W = 393;
const LINE_ICON = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Svg = ({ size = 20, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...LINE_ICON} {...rest}>
    {children}
  </svg>
);

const isFood = (l) => (l.categories || []).includes('food');
// A café is a food place whose kinds are coffee (and maybe one more, like
// bakery); a restaurant that serves cafecito is still a restaurant.
const isCafe = (l) => {
  if (!isFood(l)) return false;
  const kinds = placeKinds(l);
  return kinds.has('coffee') && kinds.size <= 2;
};
const has = (cat) => (l) => (l.categories || []).includes(cat);

const CATEGORIES = [
  {
    id: 'all',
    label: 'All',
    test: null,
    icon: (
      <Svg>
        <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" />
        <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" />
      </Svg>
    ),
  },
  {
    id: 'restaurants',
    label: 'Restaurants',
    test: (l) => isFood(l) && !isCafe(l),
    icon: (
      <Svg>
        <path d="M6 3v6.5a2 2 0 0 0 4 0V3M8 3v18M17.5 21V3c-2 1-3.3 3.3-3.3 6.3V13h3.3" />
      </Svg>
    ),
  },
  {
    id: 'cafes',
    label: 'Cafés',
    test: isCafe,
    icon: (
      <Svg>
        <path d="M4 7h12.5v6.5A5.5 5.5 0 0 1 11 19H9.5A5.5 5.5 0 0 1 4 13.5z" />
        <path d="M16.5 9h1.8a2.6 2.6 0 0 1 0 5.2h-1.9" />
      </Svg>
    ),
  },
  {
    id: 'nightlife',
    label: 'Nightlife',
    test: has('local-life'),
    icon: (
      <Svg>
        <path d="M4.5 4h15L12 12.5zM12 12.5V20M8 20h8" />
      </Svg>
    ),
  },
  {
    id: 'outdoors',
    label: 'Outdoors',
    test: has('parks-nature'),
    icon: (
      <Svg>
        <path d="M12 2.5 8 8h2.2L6.5 13h2.8L5 18.5h14L14.7 13h2.8L13.8 8H16zM12 18.5V22" />
      </Svg>
    ),
  },
  {
    id: 'culture',
    label: 'Culture',
    test: has('history-culture'),
    icon: (
      <Svg>
        <path d="M3.5 9 12 4l8.5 5zM5 9.5h14M6.5 10v7M10 10v7M14 10v7M17.5 10v7M4 19.5h16" />
      </Svg>
    ),
  },
];

// The chips under the search bar choose which pins show (Landmarks is
// everything that is not food or nightlife). Same category data the rest of
// the screen reads; no new data.
const PIN_FILTERS = [
  { id: 'all', label: 'All', test: null },
  { id: 'landmarks', label: 'Landmarks', test: (l) => !isFood(l) && !has('local-life')(l) },
  { id: 'restaurants', label: 'Restaurants', test: isFood },
  { id: 'nightlife', label: 'Nightlife', test: has('local-life') },
  { id: 'outdoors', label: 'Outdoors', test: has('parks-nature') },
];

const LIST_SHOWN = 6;

// "Restaurant · Healthy": the kind of place, then its first finer kind.
function kindLine(l) {
  const cat = primaryCategory(l.categories);
  const main = isCafe(l) ? 'Café' : cat === 'food' ? 'Restaurant' : cat ? categoryLabel(cat) : 'Landmark';
  const kind = [...placeKinds(l)].find((k) => k !== 'coffee');
  const nice = kind ? kind.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : null;
  return nice ? `${main} · ${nice}` : main;
}

const shortCount = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n));

// Apple Maps style pins: a small round icon with a white symbol, blue until
// you have checked in there, green after (the status colors, #0A84FF and
// #30D158). The selected one gets a white ring and a pointed tail.
const PIN_STATUS = { todo: '#0A84FF', done: '#30D158' };
const PIN_SYMBOL = {
  todo: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.3" fill="#fff"/>',
  done: '<path d="m6.5 12.5 4 4 7-8.5" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
};
const pinIcons = {};
function pinIcon(done, on) {
  const key = `${done ? 'done' : 'todo'}${on ? '-on' : ''}`;
  if (!pinIcons[key]) {
    const status = done ? 'done' : 'todo';
    const size = on ? 34 : 26;
    pinIcons[key] = L.divIcon({
      className: `mul-pin mul-pin-${status}${on ? ' mul-pin-on' : ''}`,
      html: `<span class="mul-pin-dot" style="background:${PIN_STATUS[status]}"><svg width="${on ? 20 : 15}" height="${on ? 20 : 15}" viewBox="0 0 24 24" aria-hidden="true">${PIN_SYMBOL[status]}</svg></span>${on ? `<span class="mul-pin-tail" style="border-top-color:${PIN_STATUS[status]}"></span>` : ''}`,
      iconSize: [size, on ? size + 8 : size],
      iconAnchor: [size / 2, on ? size + 8 : size / 2],
    });
  }
  return pinIcons[key];
}

const SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const STREET = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

// Gives the parent the Leaflet map, and reports pans (for which pins to
// draw) and taps on the map (to fold the sheet down).
function MapHooks({ onReady, onMove, onTap }) {
  const map = useMap();
  useEffect(() => onReady(map), [map, onReady]);
  useMapEvents({ moveend: () => onMove(map), click: onTap });
  return null;
}

function Bookmark({ place, className }) {
  const fav = useFavorites();
  const region = place.regionId || place.region;
  const on = fav.isFavorite(region, place.id);
  if (!fav.signedIn) return null;
  return (
    <button
      type="button"
      className={`mul-bookmark ${on ? 'on' : ''} ${className || ''}`}
      aria-pressed={on}
      aria-label={on ? `Remove ${place.name} from saved` : `Save ${place.name}`}
      onClick={(e) => {
        e.stopPropagation();
        (on ? fav.remove(region, place.id) : fav.add({ region, id: place.id, name: place.name, lat: place.lat, lng: place.lng })).catch(() => {});
      }}
    >
      <Svg size={18} strokeWidth={1.8} fill={on ? 'currentColor' : 'none'}>
        <path d="M6.5 3.5h11v17L12 16.2l-5.5 4.3z" />
      </Svg>
    </button>
  );
}

// The card a tapped pin opens: status icon, name, kind, rating, distance, a
// 64pt thumbnail and the bookmark. Tapping it opens the landmark's page.
function PinCard({ place, done, rating, distance, onOpen }) {
  return (
    <div className="mul-pincard" data-pick={pickKey(place)}>
      <button type="button" className="mul-pincard-main" onClick={onOpen}>
        <span className={`mul-pincard-icon ${done ? 'done' : ''}`} aria-hidden="true">
          <Svg size={22} strokeWidth={2}>
            {done ? <path d="m6.5 12.5 4 4 7-8.5" /> : <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />}
          </Svg>
        </span>
        <span className="mul-pincard-body">
          <strong>{place.name}</strong>
          <span className="mul-pincard-kind">{kindLine(place)}</span>
          <span className="mul-pincard-meta">
            {rating && (
              <>
                <span className="mul-star" aria-hidden="true">
                  {'\u{2605}'}
                </span>
                {Number(rating.avg).toFixed(1)} ({shortCount(rating.count)}){distance ? ' · ' : ''}
              </>
            )}
            {distance}
          </span>
        </span>
        <PickPhoto pick={{ ...place, image: place.image ?? place.images?.[0] ?? null }} className="mul-pincard-img" />
      </button>
      <Bookmark place={place} className="mul-pincard-save" />
    </div>
  );
}

export default function MapUILab({ fullScreen = false }) {
  const navigate = useNavigate();
  const { units } = useUnits();
  const { claimedMap } = useCheckIn();
  const { coords, error: geoError, lastKnown } = useGeo();
  const where = useWhereAmI();
  const mp = useMapPicks({ coords, geoError, showRefresh: true });

  const rootRef = useRef(null);
  const [box, setBox] = useState({ w: W, h: 760 });
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const fit = () => setBox({ w: el.clientWidth || W, h: el.clientHeight || 760 });
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const zoom = Math.min(box.w, 480) / W;
  const uiH = box.h / zoom;

  // ---- Map ----
  const mapRef = useRef(null);
  const [satellite, setSatellite] = useState(true);
  const [view, setView] = useState(null); // { lat, lng, km } of the map's center and reach
  const [selected, setSelected] = useState(null); // pickKey of the highlighted place
  const [pinFilter, setPinFilter] = useState('all');
  const center = coords || lastKnown || REGIONS[0].center;
  const [startCenter] = useState(() => [center.lat, center.lng]);
  const onReady = useCallback((map) => {
    mapRef.current = map;
    const c = map.getCenter();
    setView({ lat: c.lat, lng: c.lng });
  }, []);
  const onMove = useCallback((map) => {
    const c = map.getCenter();
    setView({ lat: c.lat, lng: c.lng });
  }, []);
  // First fix: center on you.
  const centered = useRef(false);
  useEffect(() => {
    if (!coords || centered.current || !mapRef.current) return;
    centered.current = true;
    mapRef.current.setView([coords.lat, coords.lng], 16, { animate: false });
  }, [coords, view]);
  const locate = () => {
    if (coords && mapRef.current) mapRef.current.flyTo([coords.lat, coords.lng], Math.max(mapRef.current.getZoom(), 16), { duration: 0.6 });
  };
  // The nearest 150 landmarks to the map's center get pins.
  const pins = useMemo(() => {
    if (!view) return [];
    const chip = PIN_FILTERS.find((f) => f.id === pinFilter);
    return ALL_LANDMARKS.filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng) && (!chip.test || chip.test(l)))
      .map((l) => ({ l, d: distanceMeters(view.lat, view.lng, l.lat, l.lng) }))
      .filter((x) => x.d < 8000)
      .sort((a, b) => a.d - b.d)
      .slice(0, 150)
      .map((x) => x.l);
  }, [view, pinFilter]);
  const selectedPlace = useMemo(() => {
    if (!selected) return null;
    const [region, id] = selected.split('/');
    return ALL_LANDMARKS.find((l) => (l.regionId || l.region) === region && l.id === id) || null;
  }, [selected]);

  // ---- Sheet ----
  // peek: just the "Picked for you right now" bar; mid: half up; full: up
  // to just under the location pill.
  const [sheet, setSheet] = useState('peek');
  const [drag, setDrag] = useState(null); // { startY, startTop, top, t }
  const fullTop = 214;
  const midTop = Math.round(uiH * 0.42);
  const snapTop = sheet === 'full' ? fullTop : midTop;
  const dragStart = (e) => {
    if (sheet === 'peek') return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ startY: e.clientY, startTop: snapTop, top: snapTop, t: Date.now(), moved: false });
  };
  const dragMove = (e) => {
    if (!drag) return;
    const dy = (e.clientY - drag.startY) / zoom;
    setDrag((d) => ({ ...d, top: Math.max(fullTop, d.startTop + dy), moved: d.moved || Math.abs(dy) > 4 }));
  };
  const dragEnd = (e) => {
    if (!drag) return;
    const dy = (e.clientY - drag.startY) / zoom;
    const fast = Math.abs(dy) / Math.max(1, Date.now() - drag.t) > 0.5;
    const top = drag.startTop + dy;
    let next = sheet;
    if (!drag.moved) next = sheet === 'full' ? 'mid' : 'full';
    else if (fast) next = dy < 0 ? 'full' : sheet === 'full' ? 'mid' : 'peek';
    else next = top < (fullTop + midTop) / 2 ? 'full' : top < midTop + (uiH - midTop) / 2 ? 'mid' : 'peek';
    setSheet(next);
    setDrag(null);
  };

  const [cat, setCat] = useState('all');
  const [seeAll, setSeeAll] = useState(false);
  const [distOpen, setDistOpen] = useState(false);

  // The Nearby list: All is Mapr's picks first, then the rest of what's in
  // range in Mapr's order; a category is that category in Mapr's order.
  const { state: pickState, picks: topPicks, pool, rankRow, rowLogger } = mp;
  const list = useMemo(() => {
    if (pickState !== 'ready') return [];
    const c = CATEGORIES.find((x) => x.id === cat);
    if (!c.test) {
      const top = topPicks || [];
      const seen = new Set(top.map(pickKey));
      return [...top, ...rankRow(pool).filter((p) => !seen.has(pickKey(p)))];
    }
    return rankRow(pool.filter(c.test));
  }, [pickState, topPicks, pool, rankRow, cat]);
  const shown = seeAll ? list.slice(0, 40) : list.slice(0, LIST_SHOWN);
  // Log what the list shows: the top set through the sheet's own logger, the
  // other lists as a row of their own.
  // Only while the sheet is up: the list counts as shown when you can see it.
  const open = sheet !== 'peek';
  const onListShown = useMemo(() => rowLogger(`ui-nearby-${cat}`), [rowLogger, cat]);
  useShownEffect(onListShown, open ? shown : []);

  const similar = useMemo(() => (mp.similar || []).slice(0, SIMILAR_LIMIT), [mp.similar]);
  const { votes, removed, vote } = usePickVotes({ uid: mp.uid, origin: mp.origin });
  const similarShown = similar.filter((p) => !removed.has(p.id));
  useShownEffect(mp.liked ? mp.onSimilarShown : null, open ? similarShown : []);

  const focus = (p) => {
    setSelected(pickKey(p));
    if (mapRef.current && Number.isFinite(p.lat)) mapRef.current.flyTo([p.lat, p.lng], Math.max(mapRef.current.getZoom(), 16), { duration: 0.6 });
  };

  // ---- Search ----
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    const from = view || center;
    return ALL_LANDMARKS.filter((l) => l.name?.toLowerCase().includes(t))
      .map((l) => ({ ...l, distanceMeters: distanceMeters(from.lat, from.lng, l.lat, l.lng) }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 8);
  }, [q, view, center]);

  const unit = distanceUnitLabel(units);
  const stateNote =
    mp.state === 'locked'
      ? ratePlacesText(mp.ratingsCount)
      : mp.state === 'no-location'
        ? 'Turn on location to see places picked for you nearby.'
        : !mp.uid
          ? 'Sign in to see places picked for you.'
          : null;

  return (
    <div className={`mul ${fullScreen ? 'mul-full' : ''}`} ref={rootRef}>
      <MapContainer className="mul-map" center={startCenter} zoom={15} zoomControl={false} attributionControl={false}>
        <TileLayer key={satellite ? 'sat' : 'street'} url={satellite ? SATELLITE : STREET} maxZoom={19} />
        {satellite && <TileLayer url={LABELS} zIndex={650} maxZoom={19} />}
        <MapHooks onReady={onReady} onMove={onMove} onTap={() => {
            setSheet('peek');
            setSelected(null);
          }} />
        {pins.map((l) => {
          const key = `${l.regionId || l.region}/${l.id}`;
          return (
            <Marker
              key={key}
              position={[l.lat, l.lng]}
              icon={pinIcon(!!claimedMap?.[l.id], selected === key)}
              zIndexOffset={selected === key ? 1000 : 0}
              eventHandlers={{
                click: (e) => {
                  e.originalEvent?.stopPropagation?.();
                  setSelected(key);
                  setSheet('peek');
                },
              }}
              title={l.name}
            />
          );
        })}
        {coords && (
          <>
            <Circle center={[coords.lat, coords.lng]} radius={Math.max(30, Math.min(coords.accuracy || 60, 120))} pathOptions={{ color: '#0A84FF', weight: 0, fillColor: '#0A84FF', fillOpacity: 0.2 }} />
            <CircleMarker center={[coords.lat, coords.lng]} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#0A84FF', fillOpacity: 1 }} />
          </>
        )}
      </MapContainer>

      <div className="mul-ui" style={{ zoom, height: uiH, '--z': zoom }}>
        <div className="mul-top">
          <AppleTopBar />
          <button type="button" className="mul-searchpill" aria-label="Search places" onClick={() => setSearchOpen(true)}>
            <Svg size={18} strokeWidth={2}>
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m15.5 15.5 5 5" />
            </Svg>
            <span>Search landmarks</span>
          </button>
          <div className="mul-filters" role="group" aria-label="Show on the map">
            {PIN_FILTERS.map((f) => (
              <button key={f.id} type="button" className={`ap-pill ${pinFilter === f.id ? 'on' : ''}`} aria-pressed={pinFilter === f.id} onClick={() => setPinFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          {where.coords && (
            <button
              type="button"
              className="mul-where"
              onClick={() => {
                const place = !where.traveling ? where.here?.place || where.near : null;
                const region = place?.regionId || place?.region;
                if (place?.id && region) navigate(`/landmarks/${region}/${place.id}`);
              }}
            >
              <span className="mul-where-pin" aria-hidden="true">
                {where.traveling ? '\u{1F697}' : '\u{1F4CD}'}
              </span>
              <span className="mul-where-text">{where.here?.place && !where.traveling ? `At ${where.text}` : where.text}</span>
              <Svg size={16} strokeWidth={2}>
                <path d="m9 6 6 6-6 6" />
              </Svg>
            </button>
          )}
        </div>

        <div className="mul-tools">
          <button type="button" className={`mul-round ${satellite ? '' : 'on'}`} aria-label={satellite ? 'Switch to street map' : 'Switch to satellite'} onClick={() => setSatellite((s) => !s)}>
            <Svg size={22} strokeWidth={1.7}>
              <path d="m12 3.5 8.5 4.5L12 12.5 3.5 8z" />
              <path d="m3.5 12 8.5 4.5 8.5-4.5" />
              <path d="m3.5 16 8.5 4.5 8.5-4.5" />
            </Svg>
          </button>
          <button type="button" className="mul-round" aria-label="Add a landmark" onClick={() => navigate('/add-landmark')}>
            <Svg size={22} strokeWidth={1.9}>
              <path d="M12 5v14M5 12h14" />
            </Svg>
          </button>
          <button type="button" className="mul-round mul-locate" aria-label="Center on me" disabled={!coords} onClick={locate}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.5 3.5 3.5 10.6l7.2 2.2 2.2 7.2z" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div className={`mul-float ${sheet === 'peek' ? '' : 'hide'}`}>
          <div className="mul-dist-wrap">
            <button type="button" className="mul-dist" aria-haspopup="listbox" aria-expanded={distOpen} onClick={() => setDistOpen((o) => !o)}>
              {mp.distance} {unit}
              <Svg size={16} strokeWidth={2}>
                <path d="m6 9 6 6 6-6" />
              </Svg>
            </button>
            {distOpen && (
              <ul className="mul-dist-menu" role="listbox" aria-label="Distance">
                {DISTANCE_OPTIONS_MI.map((n) => (
                  <li key={n}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={n === mp.distance}
                      className={n === mp.distance ? 'on' : ''}
                      onClick={() => {
                        mp.chooseDistance(n);
                        setDistOpen(false);
                        if (mapRef.current && coords) {
                          const meters = optionToMiles(n, units) * 1609.34;
                          mapRef.current.flyToBounds(L.latLng(coords.lat, coords.lng).toBounds(meters * 2), { duration: 0.6 });
                        }
                      }}
                    >
                      {n} {unit}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {geoError && sheet === 'peek' && (
          <p className="mul-geo-error" role="alert">
            {geoError}
          </p>
        )}

        {selectedPlace && sheet === 'peek' && (
          <PinCard place={selectedPlace} done={!!claimedMap?.[selectedPlace.id]} rating={mp.ratings?.[selectedPlace.id]?.count ? mp.ratings[selectedPlace.id] : selectedPlace.rating?.count ? selectedPlace.rating : null} distance={view || center ? formatDistance(distanceMeters((coords || center).lat, (coords || center).lng, selectedPlace.lat, selectedPlace.lng), units) : null} onOpen={() => navigate(`/landmarks/${selectedPlace.regionId || selectedPlace.region}/${selectedPlace.id}`)} />
        )}

        <button type="button" className={`mul-peek ${sheet === 'peek' ? '' : 'hide'}`} onClick={() => setSheet('mid')}>
          <span className="mul-handle" aria-hidden="true" />
          <span className="mul-peek-title">Picked for you right now</span>
          <Svg size={22} strokeWidth={2}>
            <path d="m9 6 6 6-6 6" />
          </Svg>
        </button>

        <section
          className={`mul-sheet ${sheet === 'peek' ? 'down' : ''} ${sheet !== 'peek' && !drag ? 'scroll' : ''} ${drag ? 'dragging' : ''}`}
          style={{ top: drag ? drag.top : sheet === 'peek' ? uiH : snapTop }}
          aria-label="Picked for you right now"
          aria-hidden={sheet === 'peek'}
        >
          <div className="mul-grab" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}>
            <span className="mul-handle" aria-hidden="true" />
            <h2 className="mul-sheet-title">Picked for you right now</h2>
          </div>

          {stateNote ? (
            <p className="mul-note">{stateNote}</p>
          ) : (
            <>
              <div className="mul-cats" role="tablist" aria-label="Kinds of places">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={cat === c.id}
                    className={`mul-cat ${cat === c.id ? 'on' : ''}`}
                    onClick={() => {
                      setCat(c.id);
                      setSeeAll(false);
                    }}
                  >
                    {c.icon}
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>

              <div className="mul-sec-head">
                <h3>
                  Nearby <span>· {mp.distance} {unit}</span>
                </h3>
                {list.length > LIST_SHOWN && (
                  <button type="button" className="mul-see-all" onClick={() => setSeeAll((v) => !v)}>
                    {seeAll ? 'Show less' : 'See all'}
                  </button>
                )}
              </div>

              {!mp.picks && mp.state === 'ready' ? (
                <ul className="mul-list" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <li key={i} className="mul-row mul-row-skel" />
                  ))}
                </ul>
              ) : shown.length ? (
                <ul className="mul-list">
                  {shown.map((p) => {
                    const key = pickKey(p);
                    const rating = p.rating?.count ? p.rating : mp.ratings?.[p.id]?.count ? mp.ratings[p.id] : null;
                    return (
                      <li key={key}>
                        <div className={`mul-row ${selected === key ? 'on' : ''}`} data-pick={key}>
                          <button type="button" className="mul-row-main" onClick={() => (selected === key ? navigate(`/landmarks/${p.regionId || p.region}/${p.id}`) : focus(p))}>
                            <PickPhoto pick={{ ...p, image: p.image ?? p.images?.[0] ?? null }} className="mul-row-img" />
                            <span className="mul-row-body">
                              <strong>{p.name}</strong>
                              <span className="mul-row-kind">{kindLine(p)}</span>
                              <span className="mul-row-meta">
                                {rating && (
                                  <>
                                    <span className="mul-star" aria-hidden="true">
                                      {'\u{2605}'}
                                    </span>
                                    {Number(rating.avg).toFixed(1)} ({shortCount(rating.count)}) <i>·</i>{' '}
                                  </>
                                )}
                                {p.distanceMeters != null ? formatDistance(p.distanceMeters, units) : ''}
                              </span>
                            </span>
                          </button>
                          <Bookmark place={p} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mul-note">Nothing like this within {mp.distance} {unit} yet. Try a bigger distance.</p>
              )}

              {mp.liked && similarShown.length > 0 && (
                <>
                  <h3 className="mul-because">Because you liked {mp.liked.name}</h3>
                  <div className="mul-carousel">
                    {similarShown.map((p) => {
                      const v = votes[p.id];
                      return (
                        <article key={pickKey(p)} className="mul-card" data-pick={pickKey(p)}>
                          <button type="button" className="mul-card-photo" onClick={() => navigate(`/landmarks/${p.regionId || p.region}/${p.id}`)} aria-label={`Open ${p.name}`}>
                            <PickPhoto pick={{ ...p, image: p.image ?? p.images?.[0] ?? null }} className="mul-card-img" />
                          </button>
                          <Bookmark place={p} className="mul-card-save" />
                          <div className="mul-card-body">
                            <h4>{p.name}</h4>
                            <p>
                              {p.distanceMeters != null ? formatDistance(p.distanceMeters, units) : ''}
                              {p.distanceMeters != null ? ' · ' : ''}
                              {primaryCategory(p.categories) ? categoryLabel(primaryCategory(p.categories)) : 'Landmark'}
                            </p>
                            <DirectionsButton name={p.name} lat={p.lat} lng={p.lng} className="mul-dir">
                              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M20.5 3.5 3.5 10.6l7.2 2.2 2.2 7.2z" fill="currentColor" />
                              </svg>
                              Directions
                            </DirectionsButton>
                            {mp.uid && (
                              <div className="mul-votes" role="group" aria-label={`Would you go to ${p.name}?`}>
                                {VOTE_ORDER.map((verdict) => {
                                  const on = v?.verdict === verdict;
                                  return (
                                    <button
                                      key={verdict}
                                      type="button"
                                      className={`mul-vote ${on ? 'on' : ''}`}
                                      aria-pressed={on}
                                      disabled={v?.status === 'saving'}
                                      onClick={() => vote({ id: p.id, region: p.regionId || p.region, name: p.name, categories: p.categories || [] }, verdict)}
                                    >
                                      <span aria-hidden="true">{VOTE_COPY[verdict].emoji}</span> {VOTE_COPY[verdict].label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </section>

        {searchOpen && (
          <div className="mul-search" role="dialog" aria-label="Search places">
            <div className="mul-search-bar">
              <Svg size={18} strokeWidth={1.9}>
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m15.5 15.5 5 5" />
              </Svg>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search landmarks" aria-label="Search landmarks" />
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(false);
                  setQ('');
                }}
              >
                Cancel
              </button>
            </div>
            {results.length > 0 && (
              <ul className="mul-results">
                {results.map((l) => (
                  <li key={`${l.regionId || l.region}/${l.id}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchOpen(false);
                        setQ('');
                        focus(l);
                      }}
                    >
                      <strong>{l.name}</strong>
                      <span>{formatDistance(l.distanceMeters, units)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
