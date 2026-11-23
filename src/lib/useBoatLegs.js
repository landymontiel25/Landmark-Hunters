import { useEffect, useState } from 'react';
import { findBoatRoute } from './boatRoute';

const key = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
const cache = new Map(); // "from|to" -> Promise<route | null>

/**
 * Boat routes for a trip's legs (owner, 2026-11-23: boat legs go around the
 * islands on the map). legs: [[from, to], ...] ({lat, lng}); empty when the
 * trip isn't by boat. Returns one route ({ points, distanceMeters,
 * minutes }) or null per leg, filling in as each is found.
 */
export function useBoatLegs(legs) {
  const sig = legs.map(([a, b]) => (a && b ? `${key(a)}|${key(b)}` : '')).join(';');
  const [found, setFound] = useState({ sig: '', routes: [] });
  useEffect(() => {
    if (!sig) return undefined;
    let live = true;
    const pairs = sig.split(';');
    Promise.all(
      pairs.map((p, i) => {
        if (!p) return null;
        if (!cache.has(p)) cache.set(p, findBoatRoute(legs[i][0], legs[i][1]).catch(() => null));
        return cache.get(p);
      })
    ).then((routes) => live && setFound({ sig, routes }));
    return () => {
      live = false;
    };
    // legs are captured by sig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return found.sig === sig ? found.routes : [];
}
