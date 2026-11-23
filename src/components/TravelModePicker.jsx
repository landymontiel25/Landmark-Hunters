import { travelMode } from '../lib/travelModes';

// "How are you getting around?" on an itinerary (owner, 2026-11-23): only
// the ways that fit this trip (travelModes.js travelModesFor). `picked`:
// the traveler chose one; until then the suggested one is lit and the
// question stays asked.
export default function TravelModePicker({ modes, value, picked, onChange }) {
  return (
    <div className="itin-mode">
      <p className="itin-mode-q">{picked ? 'Getting around' : 'How are you getting around?'}</p>
      <div className="itin-mode-row" role="radiogroup" aria-label="How are you getting around?">
        {modes.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            className={`itin-mode-pill ${value === id ? 'on' : ''}`}
            onClick={() => onChange(id)}
          >
            {travelMode(id).label}
          </button>
        ))}
      </div>
    </div>
  );
}
