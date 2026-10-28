import { ALL_LANDMARKS } from '../data/regions';
import { distanceMeters } from './geo';

// The `count` landmarks closest to a point, nearest first, each with its
// straight-line distance in metres. Places without coordinates are skipped.
export function nearestLandmarks(origin, count = 3, landmarks = ALL_LANDMARKS) {
  const lat = Number(origin?.lat);
  const lng = Number(origin?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const rows = [];
  for (const landmark of landmarks) {
    if (!Number.isFinite(landmark?.lat) || !Number.isFinite(landmark?.lng)) continue;
    rows.push({ landmark, meters: distanceMeters(lat, lng, landmark.lat, landmark.lng) });
  }
  return rows.sort((a, b) => a.meters - b.meters).slice(0, count);
}
