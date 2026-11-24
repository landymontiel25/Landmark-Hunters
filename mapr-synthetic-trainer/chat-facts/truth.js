// The truth the chat simulation grades Mapr's facts against (chat-sim and
// chat-boat tests): every route among the places a question names and the
// traveler, by road and on foot, the card's straight line, the app's boat
// routes when the traveler is out on the water, and the true best order.
import { haversineMeters } from '../../src/lib/haversine.js';
import { onWater, serverBoatRoute } from '../../api/_lib/waterGrids.js';
import { bestOrder } from '../../api/_lib/routeLookup.js';

const round1 = (x) => Math.round(x * 10) / 10;

// pts: the places ({ name, lat, lng }) with the traveler last when located.
// Returns { routes, onBoat }.
export async function truthRoutes({ q, pts, here, locOn, world, catalog }) {
  const routes = [];
  for (const a of pts) for (const b of pts) if (a !== b) routes.push(world.asRoute(a, b, 'drive'), world.asRoute(a, b, 'walk'));
  // A traveler out on the water is going by boat (owner, 2026-11-23):
  // Mapr's answers then use the app's own boat routes around the islands,
  // which are the truth for a boat trip.
  const onBoat = !!(locOn && (await onWater(here)));
  if (onBoat)
    for (const a of pts)
      for (const b of pts)
        if (a !== b) {
          const br = await serverBoatRoute(a, b);
          if (br) routes.push({ miles: round1(br.distanceMeters / 1609.34), km: round1(br.distanceMeters / 1000), minutes: br.minutes });
        }
  // How far, the card's way when there is no route: the straight line.
  for (const a of pts)
    for (const b of pts)
      if (a !== b) {
        const m = haversineMeters(a.lat, a.lng, b.lat, b.lng);
        routes.push({ miles: round1(m / 1609.34), km: round1(m / 1000), minutes: NaN });
      }
  if (q.intent === 'plan') {
    const best = await bestOrder(
      { stops: q.places, start: locOn ? 'my location' : '' },
      { catalog, near: locOn ? here : null, fetchImpl: world.fakeFetch, ...(onBoat ? { travelerMode: 'boat', boatRoute: serverBoatRoute } : {}) }
    );
    if (!best.error) routes.push({ miles: best.totalMiles, km: best.totalKm, minutes: best.totalMinutes }, ...best.legs);
  }
  return { routes, onBoat };
}
