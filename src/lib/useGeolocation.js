import { useEffect, useRef, useState } from 'react';
import { distanceMeters } from './geo';
import { friendlyGeoError } from './geoError';

// watchPosition fires far more often on a real phone than in desktop testing
// (every GPS jitter tick, sometimes multiple times a second). Every tick was
// producing a brand-new `coords` object, which re-renders every screen that
// reads it -- on the map, that tore down and rebuilt the marker cluster
// layer (and any open popup) on each tick, visible as constant flashing.
// Coalescing to real movement keeps things responsive for walking around
// while dropping sub-GPS-noise updates that have no visible effect anyway.
const MIN_MOVE_METERS = 10;

export function useGeolocation({ watch = true } = {}) {
  const [state, setState] = useState({ coords: null, error: null, loading: true });
  const lastCoordsRef = useRef(null);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setState({ coords: null, error: 'Geolocation is not supported on this device.', loading: false });
      return;
    }

    const onSuccess = (pos) => {
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      const last = lastCoordsRef.current;
      if (last && distanceMeters(last.lat, last.lng, next.lat, next.lng) < MIN_MOVE_METERS) {
        // Still a live fix -- clear any stale error from an earlier blip even
        // though the position hasn't moved enough to update coords.
        setState((s) => (s.error || s.loading ? { ...s, error: null, loading: false } : s));
        return;
      }
      lastCoordsRef.current = next;
      setState({ coords: next, error: null, loading: false });
    };
    // A single failed fix (common on desktops with no GPS, falling back to
    // WiFi-based positioning) doesn't mean location is gone -- watchPosition
    // keeps retrying and usually recovers on the next tick. Surface the error
    // without discarding a known-good position the UI is already using.
    const onError = (err) => {
      setState((s) => ({ ...s, error: friendlyGeoError(err), loading: false }));
    };

    const opts = { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 };

    if (watch) {
      const id = navigator.geolocation.watchPosition(onSuccess, onError, opts);
      return () => navigator.geolocation.clearWatch(id);
    }
    navigator.geolocation.getCurrentPosition(onSuccess, onError, opts);
  }, [watch]);

  return state;
}
