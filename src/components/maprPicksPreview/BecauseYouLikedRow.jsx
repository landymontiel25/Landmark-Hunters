import { SIMILAR_LIMIT } from '../../lib/nearbyPicks';
import { useReadyItems } from './useNearbyPicks';
import PickCard from './PickCard';

// "Because you liked X": up to four places like one the user loved
// (nearbyPicks.similarPlaces). Hidden when nothing similar is ready.
export default function BecauseYouLikedRow({ liked, places, limit = SIMILAR_LIMIT }) {
  const ready = useReadyItems(places, limit);
  if (!liked || !ready.length) return null;
  return (
    <section className="mpp-section">
      <h3 className="mpp-section-title">Because you liked {liked.name}</h3>
      <div className="mpp-carousel">
        {ready.map((p) => (
          <PickCard key={`${p.region}/${p.id}`} pick={p} showTag={false} />
        ))}
      </div>
    </section>
  );
}
