import { useMemo, useRef, useState } from 'react';
import { useGeo } from '../lib/GeoContext';
import { ALL_LANDMARKS } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import LandmarkThumb from '../components/LandmarkThumb';

// Test tab: "Rating slider". Trying a 5-point drag line in place of the
// three rating buttons, keeping the three phrases at 1, 3 and 5, shown
// above the line. Pick any
// landmark, drag (or tap) a point, then Check in or Rate. Nothing is saved:
// the log shows what the real app would save today (the 1-5 value and the
// three-way answer it maps to).
export const SLIDER_POINTS = [1, 2, 3, 4, 5];
export const SLIDER_PHRASES = { 1: 'Not for me', 3: "It's ok", 5: 'I love it' };
// Each point's color along the line, red to green (matches the fill).
const POINT_COLORS = { 1: '#f06a6a', 2: '#f0956a', 3: '#f2c14e', 4: '#a8c86a', 5: '#55c987' };
// Line-drawn faces in one color (owner, 2026-10-21: the emoji looked
// childish). Frown to smile, then a heart for 5.
const MOUTHS = { 1: 'M8 16.5Q12 13 16 16.5', 2: 'M8.5 16Q12 14.6 15.5 16', 3: 'M8.5 15.5H15.5', 4: 'M8.5 14.5Q12 17.2 15.5 14.5' };

export function RatingIcon({ value, size = 22 }) {
  const color = POINT_COLORS[value];
  return (
    <svg className="rate-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      {value === 5 ? (
        <path d="M12 19.5s-7-4.3-7-9.6A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.3c0 5.3-7 9.6-7 9.6z" fill={color} />
      ) : (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="9.2" cy="10" r="0.6" fill={color} />
          <circle cx="14.8" cy="10" r="0.6" fill={color} />
          <path d={MOUTHS[value]} />
        </>
      )}
    </svg>
  );
}

// The three answers the app saves now, for comparison.
export function tierForValue(v) {
  if (v >= 4) return 'I loved it';
  if (v === 3) return 'Ok';
  return "I didn't like it";
}

// Nearest of the 5 points to a spot on the line (0 = left end, 1 = right).
export function pointAt(fraction) {
  const f = Math.min(1, Math.max(0, fraction));
  return Math.round(f * 4) + 1;
}

export function RatingSlider({ value, onChange }) {
  const track = useRef(null);
  const dragging = useRef(false);
  const fromEvent = (e) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    onChange(pointAt((e.clientX - box.left) / box.width));
  };
  const pct = value ? ((value - 1) / 4) * 100 : null;
  return (
    <div className="rate-slider">
      {/* Above the line, so a finger dragging along it doesn't cover them. */}
      <div className="rate-slider-labels" aria-hidden="true">
        {SLIDER_POINTS.map((p) => (
          <span key={p} className={`rate-slider-label${value === p ? ' on' : ''}`} style={{ left: `${((p - 1) / 4) * 100}%` }}>
            {SLIDER_PHRASES[p] && <small>{SLIDER_PHRASES[p]}</small>}
            <b>{p}</b>
          </span>
        ))}
      </div>
      <div
        ref={track}
        className="rate-slider-track"
        role="slider"
        tabIndex={0}
        aria-label="How was it?"
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={value || undefined}
        aria-valuetext={value ? `${value} of 5${SLIDER_PHRASES[value] ? `, ${SLIDER_PHRASES[value]}` : ''}` : 'Not rated'}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          fromEvent(e);
        }}
        onPointerMove={(e) => dragging.current && fromEvent(e)}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(Math.min(5, (value || 2) + 1));
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(Math.max(1, (value || 4) - 1));
        }}
      >
        <div className="rate-slider-line" />
        {pct != null && <div className="rate-slider-fill" style={{ width: `${pct}%` }} />}
        {SLIDER_POINTS.map((p) => (
          <span key={p} className={`rate-slider-tick${value && p <= value ? ' on' : ''}`} style={{ left: `${((p - 1) / 4) * 100}%` }} />
        ))}
        {pct != null && (
          <span className="rate-slider-thumb" style={{ left: `${pct}%`, borderColor: POINT_COLORS[value] }} aria-hidden="true">
            <RatingIcon value={value} />
          </span>
        )}
      </div>
    </div>
  );
}

export default function RatingSliderLab() {
  const { coords } = useGeo();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [value, setValue] = useState(null);
  const [log, setLog] = useState([]);

  // Closest landmarks first (or A-Z without a location); the search box
  // reaches any landmark in the app.
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? ALL_LANDMARKS.filter((l) => l.name.toLowerCase().includes(q)) : ALL_LANDMARKS;
    const sorted = coords
      ? [...pool].sort((a, b) => distanceMeters(coords.lat, coords.lng, a.lat, a.lng) - distanceMeters(coords.lat, coords.lng, b.lat, b.lng))
      : [...pool].sort((a, b) => a.name.localeCompare(b.name));
    return sorted.slice(0, 8);
  }, [query, coords]);
  const landmark = picked || list[0] || null;

  const act = (kind) => {
    if (!landmark || !value) return;
    const line = `${new Date().toLocaleTimeString()}: ${kind === 'checkin' ? 'Checked in at' : 'Rated'} ${landmark.name}: ${value}/5${SLIDER_PHRASES[value] ? ` (${SLIDER_PHRASES[value]})` : ''}. Today's app would save "${tierForValue(value)}".`;
    setLog((l) => [line, ...l]);
  };

  return (
    <div className="card section">
      <h3 style={{ marginTop: 0 }}>{'\u{1F39A}\u{FE0F}'} Rating slider</h3>
      <p className="screen-subtitle" style={{ marginTop: -4 }}>
        Drag along the line, or tap a point. Nothing here is saved.
      </p>

      <label htmlFor="slider-lab-search" className="visually-hidden">
        Find a landmark
      </label>
      <input
        id="slider-lab-search"
        className="input"
        type="search"
        placeholder="Search any landmark"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPicked(null);
        }}
        style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {list.map((l) => (
          <button
            key={`${l.regionId}/${l.id}`}
            type="button"
            className={`chip${landmark && l.id === landmark.id && l.regionId === landmark.regionId ? ' selected' : ''}`}
            onClick={() => {
              setPicked(l);
              setValue(null);
            }}
          >
            <span>{l.name}</span>
          </button>
        ))}
      </div>

      {landmark && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
            <LandmarkThumb landmark={landmark} width={64} height={64} />
            <div>
              <strong>{landmark.name}</strong>
              <div className="screen-subtitle" style={{ fontSize: '0.8rem' }}>
                How was it?
              </div>
            </div>
          </div>
          <RatingSlider value={value} onChange={setValue} />
          <p className="rate-slider-result" aria-live="polite">
            {value ? (
              <>
                <RatingIcon value={value} size={20} /> {value}/5{SLIDER_PHRASES[value] ? ` · ${SLIDER_PHRASES[value]}` : ''}
              </>
            ) : (
              'Drag to rate'
            )}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-block" disabled={!value} onClick={() => act('checkin')}>
              {'\u{1F4CD}'} Check in
            </button>
            <button type="button" className="btn btn-ghost btn-block" disabled={!value} onClick={() => act('rate')}>
              {'\u{2B50}'} Rate
            </button>
          </div>
        </>
      )}

      {log.length > 0 && (
        <ul className="screen-subtitle" style={{ fontSize: '0.78rem', margin: '12px 0 0', paddingLeft: 18 }}>
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
