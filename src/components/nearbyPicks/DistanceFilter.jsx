import { DISTANCE_OPTIONS_MI, distanceUnitLabel } from '../../lib/nearbyPicks';
import { useUnits } from '../../lib/UnitsContext';

// How far picks may be: 1-100 miles or km, default 10 (DEFAULT_DISTANCE_MI).
export default function DistanceFilter({ value, onChange, options = DISTANCE_OPTIONS_MI }) {
  const { units } = useUnits();
  return (
    <div className="mpp-distance" role="radiogroup" aria-label="Distance">
      <span className="mpp-distance-label">Within</span>
      <div className="mpp-chips">
        {options.map((mi) => (
          <button
            key={mi}
            type="button"
            role="radio"
            aria-checked={value === mi}
            className={`mpp-chip ${value === mi ? 'active' : ''}`}
            onClick={() => onChange(mi)}
          >
            {mi} {distanceUnitLabel(units)}
          </button>
        ))}
      </div>
    </div>
  );
}
