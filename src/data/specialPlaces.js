// Places with a story the app tells itself, kept here by hand so a rebuild
// of the place packs (scripts/osm-import) never loses them. Applied when a
// place loads (registerPlaces in regions.js), in the app and on the server.
//   note        put at the start of the place's description
//   bonusPoints paid once per account for a real check-in there, by the
//               server (api/_lib/landmarkBonus.js)
export const SPECIAL_PLACES = {
  // Owner, 2026-10-21: the first landmark ever in Landmark Hunters.
  'miami/osm-w435585913': {
    name: 'Alhambra Water Tower',
    bonusPoints: 1000,
    note: 'The first landmark ever added to Landmark Hunters: check in here for 1,000 points.',
  },
};

export const specialPlace = (regionId, id) => SPECIAL_PLACES[`${regionId}/${id}`] || null;

// Adds the note to the description (once) and the bonus to the place.
export function applySpecialPlace(place) {
  const s = place && specialPlace(place.region || place.regionId, place.id);
  if (!s) return place;
  if (!String(place.summary || '').startsWith(s.note)) place.summary = `${s.note} ${place.summary || ''}`.trim();
  place.landmarkBonus = s.bonusPoints;
  return place;
}
