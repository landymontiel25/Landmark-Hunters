import { LOCATION_PRESETS } from '../../lib/nearbyPicks';

// Test-tab-only controls: which state to preview, and where to pretend to
// be. Nothing here belongs on the real tabs.

const PREVIEW_STATES = [
  { id: 'returning', label: 'Returning user with cached picks' },
  { id: 'new-user', label: 'New user under 10 ratings' },
  { id: 'location-off', label: 'Location off' },
  { id: 'old-cache', label: 'Old cache ("Updating…")' },
  { id: 'slow', label: 'Slow signal' },
];

export function PreviewAsSwitcher({ value, onChange }) {
  return (
    <div className="field mpp-control">
      <label htmlFor="mpp-preview-as">Preview as</label>
      <select id="mpp-preview-as" value={value} onChange={(e) => onChange(e.target.value)}>
        {PREVIEW_STATES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// value: a LOCATION_PRESETS id, or null for the device's real location.
export function SimulateLocation({ value, onChange, presets = LOCATION_PRESETS }) {
  return (
    <div className="mpp-control">
      <span className="mpp-control-label">Simulate location</span>
      <div className="mpp-chips">
        <button type="button" className={`mpp-chip ${value == null ? 'active' : ''}`} aria-pressed={value == null} onClick={() => onChange(null)}>
          {'\u{1F4CD}'} Real
        </button>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`mpp-chip ${value === p.id ? 'active' : ''}`}
            aria-pressed={value === p.id}
            onClick={() => onChange(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
