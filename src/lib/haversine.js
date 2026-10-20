// The one great-circle distance formula. Pure and import-free so the phone
// app, the api/ functions and scripts can all share it.
const EARTH_RADIUS_METERS = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const haversineKm = (lat1, lng1, lat2, lng2) => haversineMeters(lat1, lng1, lat2, lng2) / 1000;
