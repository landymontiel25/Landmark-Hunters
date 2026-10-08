import { useMemo } from 'react';
import { useCheckIn } from '../lib/useCheckIn';
import { useRatings } from '../lib/RatingsContext';
import { useTrip } from '../lib/TripContext';
import MaprPicksCarousel from './MaprPicksCarousel';

// "Can I rate?" in Mapr chat: the Travel Picks carousel under Mapr's reply.
// It already leaves out places you rated, voted on or checked into, so every
// card is a new place, and each answer counts toward the daily streak.
export default function MaprRatePicks({ scope = 'travel' }) {
  const { myReviews } = useRatings();
  const { claimedMap } = useCheckIn();
  const { trip } = useTrip();
  // Stable props: new arrays on every render made the carousel re-rank (and
  // possibly reorder) under your thumb. Mapr chat passes scope="chat" so a city
  // picked there doesn't overwrite the Itinerary tab's saved Travel Picks city.
  const reviews = useMemo(() => Object.values(myReviews || {}), [myReviews]);
  const checkedInIds = useMemo(() => Object.keys(claimedMap || {}), [claimedMap]);
  const regionIds = useMemo(() => (trip.activeRegion ? [trip.activeRegion] : []), [trip.activeRegion]);
  return <MaprPicksCarousel reviews={reviews} checkedInIds={checkedInIds} regionIds={regionIds} scope={scope} />;
}
