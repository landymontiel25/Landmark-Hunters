// The simulated world for the Mapr chat fact simulation: where every place
// is, the true route between any two, each place's hours, price and rating,
// and a fake Google (Places + Routes) that answers from it. Deterministic:
// the same name always lands in the same spot with the same hours.
import { findInCatalog } from '../../api/_lib/routeLookup.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = (s) => {
  let h = 2166136261;
  for (const c of String(s).toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
export const kmBetween = (a, b) => {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

export function makeWorld({ catalog, center, serverNear = null, nowMs }) {
  // A name the catalog doesn't know lands somewhere within ~20 km of the
  // traveler's city, always the same spot.
  const where = (name) => {
    const hit = findInCatalog(name, catalog, serverNear);
    if (hit) return { name: hit.name, lat: hit.lat, lng: hit.lng };
    const r = rng(hash(name));
    return { name, lat: center.lat + (r() - 0.5) * 0.36, lng: center.lng + (r() - 0.5) * 0.36 };
  };
  const route = (a, b, mode = 'drive') => {
    const k = kmBetween(a, b) * 1.3 + 0.15;
    const meters = Math.round(k * 1000);
    const walk = mode === 'walk';
    const staticSec = Math.round(walk ? (k / 4.8) * 3600 : (k / 38) * 3600 + 120);
    const sec = walk ? staticSec : Math.round(staticSec * 1.18);
    return { meters, sec, staticSec };
  };
  const asRoute = (a, b, mode) => {
    const r = route(a, b, mode);
    return {
      from: { name: a.name },
      to: { name: b.name },
      mode: mode === 'walk' ? 'walking' : 'driving',
      miles: Math.round((r.meters / 1609.34) * 10) / 10,
      km: Math.round((r.meters / 1000) * 10) / 10,
      minutes: Math.max(1, Math.round(r.sec / 60)),
      ...(mode === 'walk' ? {} : { minutesWithoutTraffic: Math.max(1, Math.round(r.staticSec / 60)) }),
    };
  };
  // Local clock is the sim's: hours are in the city's own time (offset 0
  // for simplicity, the same on both sides).
  const facts = (name) => {
    const r = rng(hash(`facts:${name}`));
    const open = 7 + Math.floor(r() * 5); // 7-11 AM
    const close = 17 + Math.floor(r() * 8); // 5 PM - midnight
    const hourNow = new Date(nowMs).getUTCHours();
    return {
      open,
      close,
      openNow: hourNow >= open && hourNow < close,
      price: 10 + Math.floor(r() * 70),
      rating: Math.round((3.5 + r() * 1.4) * 10) / 10,
    };
  };
  const clock = (h) => `${h % 12 || 12}:00 ${h % 24 >= 12 ? 'PM' : 'AM'}`;
  const iso = (h) => {
    const d = new Date(nowMs);
    d.setUTCHours(h % 24, 0, 0, 0);
    if (h >= 24 || d.getTime() < nowMs) d.setUTCDate(d.getUTCDate() + (d.getTime() < nowMs ? 1 : 0));
    return d.toISOString();
  };

  const fakeFetch = async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    const ok = (j) => ({ ok: true, json: async () => j });
    if (url.includes('places:searchText')) {
      const p = where(body.textQuery);
      const f = facts(p.name);
      return ok({
        places: [
          {
            displayName: { text: p.name },
            formattedAddress: `${100 + (hash(p.name) % 900)} Main St`,
            location: { latitude: p.lat, longitude: p.lng },
            utcOffsetMinutes: 0,
            businessStatus: 'OPERATIONAL',
            currentOpeningHours: {
              openNow: f.openNow,
              ...(f.openNow ? { nextCloseTime: iso(f.close) } : { nextOpenTime: iso(f.open) }),
              weekdayDescriptions: Array.from({ length: 7 }, () => `${clock(f.open)} – ${clock(f.close)}`),
            },
          },
        ],
      });
    }
    const ll = (w) => ({ lat: w.location.latLng.latitude, lng: w.location.latLng.longitude });
    if (url.includes('computeRoutes')) {
      const r = route(ll(body.origin), ll(body.destination), body.travelMode === 'WALK' ? 'walk' : 'drive');
      return ok({ routes: [{ distanceMeters: r.meters, duration: `${r.sec}s`, staticDuration: `${r.staticSec}s` }] });
    }
    if (url.includes('computeRouteMatrix')) {
      const out = [];
      body.origins.forEach((o, i) =>
        body.destinations.forEach((d, j) => {
          const r = route(ll(o.waypoint), ll(d.waypoint), body.travelMode === 'WALK' ? 'walk' : 'drive');
          out.push({ originIndex: i, destinationIndex: j, distanceMeters: r.meters, duration: `${r.sec}s`, condition: 'ROUTE_EXISTS' });
        })
      );
      return ok(out);
    }
    return { ok: false, json: async () => ({}) };
  };

  return { where, asRoute, facts, clock, fakeFetch };
}
