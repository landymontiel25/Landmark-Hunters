// The words on an itinerary stop card's "Show more" (owner, 2026-11-14):
// free or costs money (never a price), and how long you'll spend there,
// plus where "Book now" goes. Used by StopCard (Itinerary and group trips).
import { isPermanentlyClosed } from './closedPlace';
import { fmtVisitMinutes } from './itineraryCard';

const isFood = (stop) => (stop.categories || []).includes('food');

// (a) Free to visit, or costs money. Never a price.
export function costLine(stop) {
  if (isPermanentlyClosed(stop)) return 'Closed for good';
  if (stop.free === true) return 'Free to visit';
  if (isFood(stop)) return 'Costs money (you pay for what you order)';
  if (stop.free === false) return 'Costs money (needs a ticket)';
  return 'Might cost money. Check before you go.';
}

// (b) How long you'll spend there.
export function timeLine(stop) {
  const t = fmtVisitMinutes(stop.typicalMinutes);
  return t ? `About ${t} there` : null;
}

// Book now: the place's own booking link, else a search for tickets or a
// table. Free places have nothing to book.
export function bookingHref(stop) {
  if (stop.bookingUrl) return stop.bookingUrl;
  if (stop.free === true || isPermanentlyClosed(stop)) return null;
  if (stop.free !== false && !isFood(stop)) return null;
  const q = `${stop.name} ${isFood(stop) ? 'reservation' : 'tickets'}`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
