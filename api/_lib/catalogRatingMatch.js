import { classifyMatch } from './ratingMatch.js';
import { searchGoogleText } from './customRatingMatch.js';
import { readPlaceId, writePlaceId, placeIdKey, isFresh } from './placeLookup.js';
import { PLACE_ID_NO_MATCH_RETRY_MS } from './placeIdConstants.js';
import { placeTypeFor } from '../../src/lib/presence.js';
import { googleMatchFor } from './googleMatchHint.js';
import { distanceMeters, namesMatch } from './placeLookup.js';

// Google ratings for every catalog landmark (owner, 2026-10-29: every
// landmark should have ratings). The hand-picked and imported places get
// their Google IDs from scripts/match-rating-sources.mjs into
// src/data/ratingSourceIds.json; a landmark added to the catalog since (or one
// the script left for review) has none, so the first time anyone asks for its
// ratings it is matched here, like a user-added landmark
// (customRatingMatch.js): the shared place_ids/{region}__{id} cache first
// (api/place-photo.js fills it too), else one Google Text Search and the same
// strict match. Only the place ID is saved (the one thing Google lets us
// keep), or a "no match" note that is tried again after 30 days.
//
// A district or park (an "area") whose single Google match shares its name
// but sits farther off than the sure radius is accepted too: an area's pin
// is rarely at the spot Google puts it. Any other place needs a sure match.

const REVIEW_NAME_MATCH = /^name matches but/;

export async function catalogGooglePlaceId(
  { region, id, name, lat, lng, categories = [] },
  { read = readPlaceId, write = writePlaceId, search = searchGoogleText } = {}
) {
  const key = placeIdKey(region, id);
  if (!key) return null;
  const doc = await read(key);
  if (doc?.status === 'ok' && typeof doc.placeId === 'string' && doc.placeId) return doc.placeId;
  const hint = googleMatchFor(region, id, typeof name === 'string' ? name.trim().slice(0, 200) : '');
  // A "no match" from before the landmark had its Google name says nothing about that name.
  if (doc?.status === 'no-match' && (!hint || doc.hinted) && isFresh(doc, PLACE_ID_NO_MATCH_RETRY_MS)) return null;
  if (typeof name !== 'string' || !name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const landmark = { name: name.trim().slice(0, 200), lat, lng, categories };
  let found = null;
  if (hint) {
    // googleMatchHint.js: the landmark names its Google listing.
    const hits = await search({ ...landmark, name: hint.name });
    found = hits.find((c) => Number.isFinite(c.lat) && distanceMeters(lat, lng, c.lat, c.lng) <= hint.withinMeters && namesMatch(hint.name, c.name)) || null;
    await write(key, { status: found ? 'ok' : 'no-match', placeId: found ? String(found.id) : null, matchedName: landmark.name, lat, lng, hinted: true });
    return found ? String(found.id) : null;
  }
  const match = classifyMatch(landmark, await search(landmark));
  if (match.status === 'sure') found = match.candidate || { id: match.id, name: landmark.name };
  else if (match.status === 'review' && REVIEW_NAME_MATCH.test(match.reason || '') && placeTypeFor(landmark) === 'area') {
    found = (match.candidates || []).find((c) => c.nameMatch) || null;
  }
  await write(key, found ? { status: 'ok', placeId: String(found.id), matchedName: found.name || landmark.name, lat, lng } : { status: 'no-match', placeId: null, matchedName: landmark.name, lat, lng });
  return found ? String(found.id) : null;
}
