import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Geolocation } from '@capacitor/geolocation';
import { friendlyGeoError, isLocationDenied } from './geoError';

// One shared live location for the whole app, so a single "Refresh" control can
// update every distance on screen at once (instead of each screen watching alone).
// Geolocation goes through Capacitor's plugin rather than navigator.geolocation
// directly -- on iOS/Android that's the real native location API (falls back to
// the same browser API under the hood when running on the web).
const GeoContext = createContext(null);

const readPos = (pos) => ({
  lat: pos.coords.latitude,
  lng: pos.coords.longitude,
  accuracy: pos.coords.accuracy,
});
// A fix with a missing/NaN coordinate (a flaky device or plugin) would crash
// the map and distance math downstream -- treat it as "no fix", not a fix.
const validPos = (pos) =>
  Number.isFinite(pos?.coords?.latitude) &&
  Number.isFinite(pos?.coords?.longitude) &&
  Math.abs(pos.coords.latitude) <= 90 &&
  Math.abs(pos.coords.longitude) <= 180;

// The last fix, saved on this device so the Map can open where you are
// instantly -- a fresh GPS fix can take 10-15 s (longer on a laptop), and
// the map used to sit blank waiting for it.
const LAST_FIX_KEY = 'lh-last-fix';
const LAST_FIX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
function readLastFix() {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_FIX_KEY) || 'null');
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Date.now() - (v.t || 0) < LAST_FIX_MAX_AGE_MS ? v : null;
  } catch {
    return null;
  }
}
let lastSavedAt = 0;
// Exported so a background location fix (see useBackgroundLocationSync.js,
// which runs even when this provider's own watch isn't active) can warm the
// same cold-start cache a foreground fix would -- one instant-open location,
// whichever source produced it most recently.
export function cacheLastFix(c) {
  saveLastFix(c);
}
function saveLastFix(c) {
  if (Date.now() - lastSavedAt < 60 * 1000) return;
  lastSavedAt = Date.now();
  try {
    localStorage.setItem(LAST_FIX_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, t: Date.now() }));
  } catch {
    /* private mode */
  }
}

export function GeoProvider({ children }) {
  const [state, setState] = useState({ coords: null, error: null, loading: true });
  const [refreshing, setRefreshing] = useState(false);
  const [lastKnown] = useState(readLastFix);
  const watchId = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const onSuccess = (pos) => {
      if (!validPos(pos)) return onError({ code: 2, message: 'invalid position' });
      const coords = readPos(pos);
      saveLastFix(coords);
      setState({ coords, error: null, loading: false });
    };
    // A quick, rough fix (cached or Wi-Fi based) usually answers in well
    // under a second; the precise watch below then takes over.
    Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 4000, maximumAge: 10 * 60 * 1000 })
      .then((pos) => {
        if (!cancelled && validPos(pos)) setState((s) => (s.coords ? s : { coords: readPos(pos), error: null, loading: false }));
      })
      .catch(() => {});
    // A watch timeout while a good fix is already on screen isn't "location
    // unavailable" -- keep using the fix; only a denial is worth surfacing then.
    const onError = (err) =>
      setState((s) => ({
        ...s,
        error: s.coords && !isLocationDenied(err) ? null : friendlyGeoError(err),
        loading: false,
      }));
    Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }, (pos, err) => {
      if (err) onError(err);
      else if (pos) onSuccess(pos);
    })
      .then((id) => {
        if (cancelled) Geolocation.clearWatch({ id });
        else watchId.current = id;
      })
      .catch((err) => onError(err));
    return () => {
      cancelled = true;
      if (watchId.current != null) Geolocation.clearWatch({ id: watchId.current });
    };
  }, []);

  // Force a brand-new GPS fix (maximumAge: 0) — used by the header Refresh button.
  const refresh = useCallback(() => {
    setRefreshing(true);
    Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
      .then((pos) => {
        if (!validPos(pos)) throw new Error('invalid position');
        const coords = readPos(pos);
        saveLastFix(coords);
        setState({ coords, error: null, loading: false });
        setRefreshing(false);
      })
      .catch((err) => {
        setState((s) => ({ ...s, error: friendlyGeoError(err), loading: false }));
        setRefreshing(false);
      });
  }, []);

  return <GeoContext.Provider value={{ ...state, lastKnown, refresh, refreshing }}>{children}</GeoContext.Provider>;
}

export function useGeo() {
  const ctx = useContext(GeoContext);
  if (!ctx) throw new Error('useGeo must be used inside GeoProvider');
  return ctx;
}
