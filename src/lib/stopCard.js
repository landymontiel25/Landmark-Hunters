// The words on an itinerary stop card (owner, 2026-11-14, 2026-11-16):
// Show more's Free / Needs a ticket (never a price) and "Time Spent", the
// short description, and the "Why you need to go" fallback lines. Used by
// StopCard (Itinerary and group trips).
import { isPermanentlyClosed } from './closedPlace';

const isFood = (stop) => (stop.categories || []).includes('food');

// (a) Free or Needs a ticket (owner, 2026-11-16: never "costs money").
// Never a price. A place to eat needs no ticket; with no fee data it's
// honest about not knowing.
export function costLine(stop) {
  if (isPermanentlyClosed(stop)) return 'Closed for good';
  if (stop.free === true) return 'Free';
  if (isFood(stop)) return 'No ticket needed';
  if (stop.free === false) return 'Needs a ticket';
  return 'Might need a ticket';
}

// (b) "Time Spent: ~2 hr", "Time Spent: ~45 min", "Time Spent: ~1 hr 30 min"
// (owner, 2026-11-16).
export function timeLine(stop) {
  const m = Math.round(Number(stop?.typicalMinutes) || 0);
  if (m <= 0) return null;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `Time Spent: ~${h ? `${h} hr${r ? ` ${r} min` : ''}` : `${r} min`}`;
}

// The short description under the name (owner, 2026-11-15): the place's own
// summary from the catalog. Without one, what it is and where, from its real
// kind and area, never a made-up detail.
const KIND_LABEL = {
  'history-culture': 'Art and culture stop',
  food: 'Place to eat',
  'local-life': 'Nightlife spot',
  'parks-nature': 'Park and outdoor spot',
  sports: 'Place to get active',
  stadiums: 'Stadium',
  shopping: 'Place to shop',
  attractions: 'Day-out attraction',
  tech: 'Tech history stop',
  airports: 'Airport',
  'campus-life': 'Campus spot',
  'formula-1': 'Race circuit',
  benches: 'Spot with a view',
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function descriptionLine(stop) {
  // No em or en dashes on screen (owner's copy rule); some catalog
  // summaries have them, so they read as commas here.
  const summary = String(stop?.summary || stop?.description || '')
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .trim();
  if (summary) return summary;
  if (stop?.external) return stop.address ? `A place I found for this trip, at ${stop.address}.` : 'A place I found for this trip.';
  const kind = stop?.topic ? cap(stop.topic) : KIND_LABEL[stop?.categories?.[0]] || 'Place to visit';
  return stop?.neighborhood ? `${kind} in ${stop.neighborhood}.` : `${kind}.`;
}

// "Why you need to go" when Mapr's own lines aren't there (signed out, a
// place found on the web, or the call failed): three honest lines from the
// kind of place, in Mapr's voice. No specific claims.
const WHY_BY_KIND = {
  'history-culture': ["It's the kind of place that shows you what this city is really about.", "I'd slow down here and take in the details up close.", "Seeing it in person beats any photo of it."],
  food: ["It's a real place to eat, so you'll taste the city, not just see it.", "I'd come hungry and make it a proper break in your day.", 'A good meal is the easiest way to feel at home somewhere new.'],
  'local-life': ["It's a way to get a feel for the city after dark.", "I'd go with your friends and let the night set the pace.", "It's a fun way to end a full day out."],
  'parks-nature': ["It's a chance to slow down and get some fresh air between stops.", "I'd bring your camera and take your time outside.", "It's an easy way to recharge before your next stop."],
  sports: ["It's a way to move a little instead of only looking around.", "I'd go with whoever you're traveling with, it's more fun together.", "It's a nice change of pace from sightseeing."],
  stadiums: ["If there's a game on, the energy's something you'll want to feel in person.", "I'd catch the atmosphere around it even on a quiet day.", "It's a big part of how this city spends its weekends."],
  shopping: ["It's a fun place to browse and find something to take home.", "I'd give yourself time to wander, you never know what you'll find.", "It's a good break from sightseeing."],
  attractions: ["It's a day out made for doing, not just looking.", "I'd go with whoever you're traveling with, it's more fun together.", "It's an easy win for a day with no plan."],
  tech: ["It's a piece of tech history you can stand right in front of.", "I'd snap a photo here, it's a fun one to share.", 'It turns a story you know into a place you can see.'],
};
const WHY_DEFAULT = ["It's a real part of this place that's worth seeing in person.", "I'd give it a little time and look around.", 'It fits easily between your other stops.'];

export function fallbackWhy(stop) {
  const lines = [...(WHY_BY_KIND[stop?.categories?.[0]] || WHY_DEFAULT)];
  const t = timeLine(stop);
  if (t) lines[2] = `It only takes ${t.replace('Time Spent: ', '')}, so it's easy to fit into your day.`;
  return lines;
}
