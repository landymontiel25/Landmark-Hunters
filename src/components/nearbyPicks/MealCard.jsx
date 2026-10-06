import { MEAL_LIMIT } from '../../lib/nearbyPicks';
import { useReadyItems } from './useNearbyPicks';
import { useShownEffect } from './useShownEffect';
import { PickRow } from './PickCard';
import DirectionsButton from '../DirectionsButton';

// "Time to eat? Here are your top 3 nearby". `places` is
// nearbyPicks.mealPicks; the parent decides when it's meal time.
export default function MealCard({ places, limit = MEAL_LIMIT, onShown = null }) {
  const ready = useReadyItems(places, limit);
  useShownEffect(onShown, ready);
  if (!ready.length) return null;
  return (
    <section className="mpp-section mpp-callout">
      <h3 className="mpp-section-title">{'\u{1F37D}\u{FE0F}'} Time to eat? Here are your top {ready.length} nearby</h3>
      <ul className="mpp-rows">
        {ready.map((p) => (
          <PickRow
            key={`${p.region}/${p.id}`}
            pick={p}
            action={
              <DirectionsButton name={p.name} lat={p.lat} lng={p.lng} className="btn btn-ghost btn-sm">
                Directions
              </DirectionsButton>
            }
          />
        ))}
      </ul>
    </section>
  );
}
