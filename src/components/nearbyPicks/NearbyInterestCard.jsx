import { categoryLabel } from '../../lib/nearbyPicks';
import { primaryCategory } from '../../lib/preferenceChains';
import { useReadyItems } from './useNearbyPicks';
import PickCard from './PickCard';

// "You're near something you'd like": the closest place in one of the
// user's top categories (nearbyPicks.nearbyInterest). Hidden when none.
export default function NearbyInterestCard({ place }) {
  const ready = useReadyItems(place ? [place] : [], 1);
  const p = ready[0];
  if (!p) return null;
  return (
    <section className="mpp-section mpp-callout">
      <h3 className="mpp-section-title">
        {'\u{1F4CD}'} You're close to some {categoryLabel(primaryCategory(p.categories))}
      </h3>
      <PickCard pick={{ ...p, reason: p.reason || 'Right around the corner, and your kind of place.' }} showTag={false} />
    </section>
  );
}
