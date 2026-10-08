// Hands back the same [lat, lng] array for a key as long as its coordinates
// don't change. react-leaflet's Marker calls setLatLng whenever the position
// prop is a new array, and inside a marker cluster every setLatLng re-clusters
// that marker -- so rebuilding thousands of pins with fresh arrays (each
// place-pack load, check-in, sign-in) froze the Map for seconds at a time.
export function createPositionCache() {
  const cache = new Map();
  return (key, lat, lng) => {
    const prev = cache.get(key);
    if (prev && prev[0] === lat && prev[1] === lng) return prev;
    const next = [lat, lng];
    cache.set(key, next);
    return next;
  };
}
