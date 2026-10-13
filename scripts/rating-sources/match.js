import { namesMatch, normalizeName, distanceMeters } from '../../api/_lib/placeLookup.js';
import { placeTypeFor } from '../../src/lib/presence.js';

// Decides whether a search result is the same place as a landmark, for
// scripts/match-rating-sources.mjs. Pure: no network, no files.
//
// A match is "sure" only when exactly one candidate passes the strict name
// test (the one place photos already use) inside the landmark's radius and
// no other candidate with a matching name sits nearby. Anything close but
// not certain goes to the review file; nothing is ever guessed.

// How far the source's point may sit from ours, by place type
// (src/lib/presence.js): a park's pin can be far from its center.
export const SURE_RADIUS_M = { landmark: 150, indoor: 150, area: 400 };
// Beyond the sure radius but within this, a name match is worth a human look.
export const REVIEW_RADIUS_M = 1000;

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'at', 'in', 'on', 'de', 'la', 'le', 'el', 'los', 'las']);
const words = (s) => normalizeName(s).split(' ').filter((t) => t && !STOP.has(t));

// Share of the shorter name's words found in the other name (0-1).
export function nameOverlap(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  const shared = [...A].filter((t) => B.has(t)).length;
  return shared / Math.min(A.size, B.size);
}

// candidates: [{ id, name, lat, lng }]. Returns
//   { status: 'sure', id, candidate }
//   { status: 'review', reason, candidates: [...top 3 with distance and scores] }
//   { status: 'none' }
export function classifyMatch(landmark, candidates) {
  const sureRadius = SURE_RADIUS_M[placeTypeFor(landmark)] || SURE_RADIUS_M.landmark;
  const scored = (candidates || [])
    .filter((c) => c && c.id != null && c.name && Number.isFinite(c.lat) && Number.isFinite(c.lng))
    .map((c) => ({
      ...c,
      distanceM: Math.round(distanceMeters(landmark.lat, landmark.lng, c.lat, c.lng)),
      nameMatch: namesMatch(landmark.name, c.name),
      overlap: Math.round(nameOverlap(landmark.name, c.name) * 100) / 100,
    }))
    .sort((a, b) => a.distanceM - b.distanceM);

  const named = scored.filter((c) => c.nameMatch && c.distanceM <= REVIEW_RADIUS_M);
  const sure = named.filter((c) => c.distanceM <= sureRadius);
  const top = () => scored.slice(0, 3).map(({ id, name, lat, lng, distanceM, nameMatch, overlap }) => ({ id: String(id), name, lat, lng, distanceM, nameMatch, overlap }));

  if (sure.length === 1 && named.length === 1) {
    const { id, name, distanceM } = sure[0];
    return { status: 'sure', id: String(id), candidate: { id: String(id), name, distanceM } };
  }
  // Several matches (a venue and its sub-places: "Museum of Art" and
  // "Museum of Art Steps"): sure only if exactly one nearby name is the
  // landmark's own name word for word.
  if (sure.length > 1 || named.length > 1) {
    const own = words(landmark.name).join(' ');
    const exact = named.filter((c) => words(c.name).join(' ') === own);
    if (exact.length === 1 && exact[0].distanceM <= sureRadius) {
      const { id, name, distanceM } = exact[0];
      return { status: 'sure', id: String(id), candidate: { id: String(id), name, distanceM } };
    }
    return { status: 'review', reason: 'several places share the name', candidates: top() };
  }
  if (named.length === 1) return { status: 'review', reason: `name matches but ${named[0].distanceM} m away`, candidates: top() };
  const partial = scored.find((c) => c.distanceM <= sureRadius && c.overlap >= 0.5);
  if (partial) return { status: 'review', reason: 'nearby place with a similar name', candidates: top() };
  return { status: 'none' };
}
