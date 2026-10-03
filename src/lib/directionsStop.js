import { ALL_LANDMARKS } from '../data/regions';
import { getCustomLandmarks } from './customLandmarks';
import { ensurePlacePacks } from './placePacks';
import { asksForDirections, directionsTarget } from './placeMatch';

// "How do I get to Artisans?" when Mapr's reply came back with no card: the
// server only knows the built-in and imported places, so this looks again
// on the device, where places people added in the app are known too, and
// returns that place as a chat stop card (with its Directions button).
export async function directionsStopFor(text, near = null) {
  if (!asksForDirections(text)) return null;
  await ensurePlacePacks().catch(() => false);
  const custom = await getCustomLandmarks().catch(() => []);
  const places = [
    ...ALL_LANDMARKS,
    ...(custom || []).filter((l) => l?.id && l.name).map((l) => ({ ...l, regionId: l.region })),
  ].filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng));
  const target = directionsTarget(text, places, near);
  if (!target) return null;
  return {
    region: target.regionId,
    id: target.id,
    name: target.name,
    lat: target.lat,
    lng: target.lng,
    images: target.images || [],
    categories: target.categories || [],
    ...(target.source === 'osm' ? { source: 'osm' } : {}),
    reason: 'Tap Directions to get there.',
  };
}
