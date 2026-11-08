import { useEffect, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useGeo } from '../lib/GeoContext';
import { ALL_LANDMARKS } from '../data/regions';
import { getMapView, nearestPickableCity } from '../lib/nearestCity';
import { inScope, scopeFromKey } from '../lib/cityScope';
import { usePlacePacksVersion } from '../lib/placePacks';
import { RATINGS_FLAGS } from '../lib/ratingSources';
import { prefetchTopRatings } from '../lib/useTopRatings';

// Owner, 2026-11-08: the Landmarks tab's Popular sort must be ready the
// moment it is tapped. The app opens on the Map, so while it loads this
// looks up Google's ratings for the city the Landmarks tab will open on (the
// one the Map shows, the same rule LandmarkSelection uses) and keeps them in
// memory for the session (useTopRatings.js; never stored). It checks every
// few seconds for the first minute, so panning the Map to another city
// warms that one too. Signed in only (the ratings endpoint needs it).
export const PREFETCH_START_MS = 1500;
export const PREFETCH_EVERY_MS = 4000;
export const PREFETCH_FOR_MS = 60 * 1000;

export function cityLandmarks(cityId, landmarks = ALL_LANDMARKS) {
  if (!cityId) return [];
  const scope = scopeFromKey(cityId);
  return landmarks.filter((l) => inScope(l, scope));
}

export default function LandmarkRatingsPrefetch() {
  const { user } = useAuth();
  const packsVersion = usePlacePacksVersion();
  const { coords } = useGeo();
  const here = useRef(null);
  here.current = coords;
  const done = useRef(new Set());
  useEffect(() => {
    if (!user || !RATINGS_FLAGS.cardLine) return undefined;
    const started = Date.now();
    let timer = null;
    const tick = () => {
      // The Map's city, else the one you are in (LandmarkSelection's rules).
      const c = here.current;
      const city = nearestPickableCity(getMapView(), 50) || nearestPickableCity(c && Number.isFinite(c.lat) ? { lat: c.lat, lng: c.lng } : null, 30);
      const key = `${city}|${packsVersion}`;
      if (city && !done.current.has(key)) {
        done.current.add(key);
        prefetchTopRatings(cityLandmarks(city));
      }
      if (Date.now() - started < PREFETCH_FOR_MS) timer = setTimeout(tick, PREFETCH_EVERY_MS);
    };
    timer = setTimeout(tick, PREFETCH_START_MS);
    return () => clearTimeout(timer);
  }, [user, packsVersion]);
  return null;
}
