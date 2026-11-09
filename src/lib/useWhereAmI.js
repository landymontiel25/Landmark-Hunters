import { useEffect, useMemo, useRef, useState } from 'react';
import { useGeo } from './GeoContext';
import { ALL_LANDMARKS } from '../data/regions';
import { usePlacePacksVersion } from './placePacks';
import { getCustomLandmarks } from './customLandmarks';
import { streetAddress } from './geocode';
import { reverseGeocodePlace } from './placeLookup';
import { distanceMeters } from './geo';
import { STOP_AFTER_MS, isMoving, isStationary, nearestPlace, placeAt, shortAddress, updateAnchor } from './whereAmI';

const RESOLVE_AGAIN_METERS = 40;
const TICK_MS = 5_000;

// Where you are, as WhereAmI shows it: the landmark you're at, else your
// street address, "Near <place>" until that comes back, or "Traveling…"
// while you're moving. Also used by the Test tab's redesigned Map screen.
export function useWhereAmI() {
  const { coords } = useGeo();
  const packsVersion = usePlacePacksVersion();
  const fixes = useRef([]);
  const lastMovingAt = useRef(0);
  const anchor = useRef(null);
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
    anchor.current = updateAnchor(anchor.current, coords, t);
    // Three minutes around one spot is staying put, never traveling.
    if (isStationary(anchor.current, t)) lastMovingAt.current = 0;
    else if (isMoving(fixes.current, t)) lastMovingAt.current = t;
    setNow(t);
  }, [coords]);

  // A stopped phone sends no new fixes, so time alone has to end "Traveling".
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const traveling = !!coords && !isStationary(anchor.current, now) && now - lastMovingAt.current < STOP_AFTER_MS && lastMovingAt.current > 0;

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
  return { coords, places, here, near, traveling, text };
}

