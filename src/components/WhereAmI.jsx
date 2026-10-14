import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGeo } from '../lib/GeoContext';
import { ALL_LANDMARKS } from '../data/regions';
import { usePlacePacksVersion } from '../lib/placePacks';
import { getCustomLandmarks } from '../lib/customLandmarks';
import { streetAddress } from '../lib/geocode';
import { reverseGeocodePlace } from '../lib/placeLookup';
import { distanceMeters } from '../lib/geo';
import { STOP_AFTER_MS, isMoving, nearestPlace, placeAt, shortAddress } from '../lib/whereAmI';

// "Where I am", under the header on every tab (owner request 2026-10-14):
// the landmark you're at, else your street address, or "Traveling…" while
// you're moving. Rides down the page with the header like the back
// buttons; it sets --whereami-h to its height, which --header-h adds, so
// back buttons and the Map's buttons move down by it instead of being
// covered. Hidden until there's a location fix.

const RESOLVE_AGAIN_METERS = 40;
const TICK_MS = 5_000;

export default function WhereAmI() {
  const { coords } = useGeo();
  const navigate = useNavigate();
  const packsVersion = usePlacePacksVersion();
  const ref = useRef(null);
  const fixes = useRef([]);
  const lastMovingAt = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const [custom, setCustom] = useState([]);
  const [here, setHere] = useState(null); // { label, place?, at: {lat,lng} }

  useEffect(() => {
    let live = true;
    getCustomLandmarks()
      .then((list) => live && setCustom(list || []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Every new fix, timestamped; GeoContext already drops sub-5 m jitter.
  useEffect(() => {
    if (!coords) return;
    const t = Date.now();
    fixes.current = [...fixes.current.filter((f) => t - f.t <= 60_000), { ...coords, t }];
    if (isMoving(fixes.current, t)) lastMovingAt.current = t;
    setNow(t);
  }, [coords]);

  // A stopped phone sends no new fixes, so time alone has to end "Traveling".
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const traveling = !!coords && now - lastMovingAt.current < STOP_AFTER_MS && lastMovingAt.current > 0;

  const places = useMemo(
    () => [...ALL_LANDMARKS, ...custom],
    // ALL_LANDMARKS grows in place as place packs load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [packsVersion, custom]
  );

  // Name the spot once you've stopped, and again after you've moved on.
  useEffect(() => {
    if (!coords || traveling) return;
    const at = { lat: coords.lat, lng: coords.lng };
    const place = placeAt(at, places, coords.accuracy);
    if (place) {
      setHere((h) => (h?.place?.id === place.id ? h : { label: place.name, place, at }));
      return;
    }
    if (here && !here.place && distanceMeters(here.at.lat, here.at.lng, at.lat, at.lng) < RESOLVE_AGAIN_METERS) return;
    let live = true;
    // OpenStreetMap first (free, cached on the phone), then Google's
    // nearby-place lookup; if both fail, the nearest place (below).
    (async () => {
      let label = await streetAddress(at.lat, at.lng).catch(() => null);
      if (!label) {
        const g = await reverseGeocodePlace(at.lat, at.lng).catch(() => null);
        label = g?.address || g?.name || null;
      }
      if (live && label) setHere({ label: shortAddress(label), at });
      else if (live) setHere((h) => (h?.place ? null : h));
    })();
    return () => {
      live = false;
    };
    // `here` is read only to skip a lookup for the same spot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, traveling, places]);

  // Never blank while there's a fix: "Near <place>" until the address
  // comes back (or if it never does), else "Finding your spot…".
  const near = !traveling && !here && coords ? nearestPlace(coords, places) : null;
  const text = traveling ? 'Traveling…' : here?.label || (near ? `Near ${near.name}` : 'Finding your spot…');
  const visible = !!coords;

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!visible) {
      root.style.removeProperty('--whereami-h');
      return undefined;
    }
    const set = () => root.style.setProperty('--whereami-h', `${ref.current?.offsetHeight || 0}px`);
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    if (ro && ref.current) ro.observe(ref.current);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--whereami-h');
    };
  }, [visible]);

  if (!visible) return null;

  const place = !traveling ? here?.place || near : null;
  const open = () => {
    const region = place?.regionId || place?.region;
    if (place?.id && region) navigate(`/landmarks/${region}/${place.id}`);
    else navigate('/');
  };

  return (
    <div className="where-am-i-row" ref={ref}>
      <button
        type="button"
        className={`where-am-i${traveling ? ' where-am-i-moving' : ''}`}
        onClick={open}
        aria-live="polite"
        aria-label={traveling ? 'Where you are: traveling' : `Where you are: ${text}`}
      >
        <span aria-hidden="true">{traveling ? '\u{1F697}' : here?.place ? '\u{2B50}' : '\u{1F4CD}'}</span>
        <span className="where-am-i-text">{here?.place && !traveling ? `At ${text}` : text}</span>
      </button>
    </div>
  );
}
