import { DISTANCE_OPTIONS_MI } from '../../lib/nearbyPicks';

// How far picks may be: 1-100 miles, default 10 (DEFAULT_DISTANCE_MI).
export default function DistanceFilter({ value, onChange, options = DISTANCE_OPTIONS_MI }) {
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
            {mi} mi
          </button>
        ))}
      </div>
    </div>
  );
}
