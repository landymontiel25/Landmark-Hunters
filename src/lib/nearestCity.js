import { ALL_LANDMARKS, PICKABLE_REGIONS } from '../data/regions';
import { distanceMeters } from './geo';

const MILE = 1609.344;

// The pickable city whose closest landmark is nearest `point`, if any city
// has a landmark within `miles` of it. Null otherwise (middle of nowhere).
export function nearestPickableCity(point, miles = 30, landmarks = ALL_LANDMARKS, cities = PICKABLE_REGIONS) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  const ids = new Set(cities.map((c) => c.id));
  let city = null;
  let best = miles * MILE;
  for (const l of landmarks) {
    if (!ids.has(l.regionId) || !Number.isFinite(l.lat) || !Number.isFinite(l.lng)) continue;
    const d = distanceMeters(point.lat, point.lng, l.lat, l.lng);
    if (d <= best) {
      best = d;
      city = l.regionId;
    }
  }
  return city;
}

// Where the Map tab was last looking, at city scale, so the Landmarks tab can
// show that city. Module state: it lasts for the visit, not across launches.
let mapView = null;
export const setMapView = (point) => {
  mapView = point && Number.isFinite(point.lat) && Number.isFinite(point.lng) ? { lat: point.lat, lng: point.lng } : null;
};
export const getMapView = () => mapView;
