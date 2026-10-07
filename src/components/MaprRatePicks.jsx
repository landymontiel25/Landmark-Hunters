import { useCheckIn } from '../lib/useCheckIn';
import { useRatings } from '../lib/RatingsContext';
import { useTrip } from '../lib/TripContext';
import MaprPicksCarousel from './MaprPicksCarousel';

// "Can I rate?" in Mapr chat: the Travel Picks carousel under Mapr's reply.
// It already leaves out places you rated, voted on or checked into, so every
// card is a new place, and each answer counts toward the daily streak.
export default function MaprRatePicks() {
  const { myReviews } = useRatings();
  const { claimedMap } = useCheckIn();
  const { trip } = useTrip();
  return (
    <MaprPicksCarousel
      reviews={Object.values(myReviews || {})}
      checkedInIds={Object.keys(claimedMap || {})}
      regionIds={trip.activeRegion ? [trip.activeRegion] : []}
    />
  );
}
