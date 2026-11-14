import { useState } from 'react';
import './NewUILab.css';

// Test tab: "New UI" (owner, 2026-11-14). The reference build of the design
// language in docs/design-language.md: Quiet base (white, Inter, gold as the
// only accent) with Mapr as the Character inside it. Three sample screens
// (Plan, Place, Trip) on sample data. Nothing here touches the live app and
// nothing is saved; the Light / Dark switch only changes this preview.

const PLACES = [
  {
    id: 'statue',
    name: 'Statue of Liberty',
    area: 'Liberty Island',
    photo: '/intro/nyc-statue-clear-sky.jpg',
    why: 'Because you liked Ellis Island',
    fact: 'Dedicated on October 28, 1886.',
    source: 'nps.gov',
    sourceUrl: 'https://www.nps.gov/stli/learn/historyculture/index.htm',
  },
  {
    id: 'park',
    name: 'Central Park',
    area: 'Manhattan',
    photo: '/intro/nyc-central-park.jpg',
    why: 'You save a lot of parks',
    fact: 'Parts of the park first opened to the public in 1858.',
    source: 'centralparknyc.org',
    sourceUrl: 'https://www.centralparknyc.org/park-history',
  },
  {
    id: 'times',
    name: 'Times Square',
    area: 'Midtown',
    photo: '/intro/nyc-times-square.jpg',
    why: 'Found by people like you',
    fact: 'Named Times Square in 1904.',
    source: 'timessquarenyc.org',
    sourceUrl: 'https://www.timessquarenyc.org/history',
  },
];

const STOPS = [
  { time: '9:30', place: PLACES[0], found: true, walk: null },
  { time: '12:15', place: PLACES[2], found: true, walk: '25 min by subway' },
  { time: '2:00', place: PLACES[1], found: false, walk: '12 min walk' },
];

const MOODS = ['Outdoors', 'History', 'Food', 'Art', 'Views'];

const SCREENS = [
  { id: 'plan', label: 'Plan' },
  { id: 'place', label: 'Place' },
  { id: 'trip', label: 'Trip' },
];

function MaprSpark({ size = 18 }) {
  return (
    <svg className="nui-spark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2c.9 5.6 3.4 8.2 10 10-6.6 1.8-9.1 4.4-10 10-.9-5.6-3.4-8.2-10-10 6.6-1.8 9.1-4.4 10-10z" />
    </svg>
  );
}

function MaprLine({ children }) {
  return (
    <div className="nui-mapr" role="note" aria-label="Mapr">
      <MaprSpark />
      <p>{children}</p>
    </div>
  );
}

function PlaceCard({ place, onOpen }) {
  return (
    <button type="button" className="nui-card" onClick={() => onOpen(place)}>
      <img src={place.photo} alt="" className="nui-card-photo" />
      <span className="nui-card-name">{place.name}</span>
      <span className="nui-card-why">{place.why}</span>
    </button>
  );
}

function PlanScreen({ onOpen }) {
  const [mood, setMood] = useState('History');
  return (
    <div className="nui-screen">
      <p className="nui-label">Saturday, November 14</p>
      <h1 className="nui-title">Plan</h1>
      <div className="nui-search" role="search">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="nui-icon">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <span>Search places</span>
      </div>
      <MaprLine>Morning. You have the afternoon free in Midtown. I found three stops that fit.</MaprLine>
      <button type="button" className="nui-btn-primary nui-wide">See the plan</button>

      <section className="nui-section">
        <h2 className="nui-h2">Picked for you</h2>
        <div className="nui-chips" role="group" aria-label="Mood">
          {MOODS.map((m) => (
            <button
              key={m}
              type="button"
              className={`nui-chip ${mood === m ? 'on' : ''}`}
              aria-pressed={mood === m}
              onClick={() => setMood(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="nui-row-scroll">
          {PLACES.map((p) => (
            <PlaceCard key={p.id} place={p} onOpen={onOpen} />
          ))}
        </div>
      </section>

      <section className="nui-section">
        <h2 className="nui-h2">Near you</h2>
        <ul className="nui-list">
          {PLACES.map((p) => (
            <li key={p.id}>
              <button type="button" className="nui-list-row" onClick={() => onOpen(p)}>
                <img src={p.photo} alt="" className="nui-thumb" />
                <span className="nui-list-text">
                  <span className="nui-row-title">{p.name}</span>
                  <span className="nui-meta">{p.area}</span>
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="nui-icon nui-chev">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PlaceScreen({ place, onBack }) {
  const [added, setAdded] = useState(false);
  return (
    <div className="nui-screen nui-screen-flush">
      <div className="nui-hero">
        <img src={place.photo} alt="" />
        <button type="button" className="nui-hero-back" onClick={onBack} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="nui-icon">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </button>
        <div className="nui-hero-text">
          <p className="nui-hero-area">{place.area}</p>
          <h1 className="nui-hero-title">{place.name}</h1>
        </div>
      </div>
      <div className="nui-pad">
        <MaprLine>{place.why}. It's a 12 minute walk from your last stop, so it fits before sunset.</MaprLine>
        <div className="nui-actions">
          <button
            type="button"
            className="nui-btn-primary"
            aria-pressed={added}
            onClick={() => setAdded((a) => !a)}
          >
            {added ? 'Added to trip' : 'Add to trip'}
          </button>
          <button type="button" className="nui-btn">Directions</button>
        </div>
        <section className="nui-section">
          <p className="nui-label">Facts</p>
          <div className="nui-fact">
            <p>{place.fact}</p>
            <a href={place.sourceUrl} target="_blank" rel="noreferrer" className="nui-source">
              Source: {place.source}
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function ProgressRing({ found, total }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="nui-ring" role="img" aria-label={`${found} of ${total} found`}>
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r={r} className="nui-ring-track" />
        <circle
          cx="28"
          cy="28"
          r={r}
          className="nui-ring-fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - found / total)}
        />
      </svg>
      <span>
        <strong>{found}</strong>/{total}
      </span>
    </div>
  );
}

function TripScreen({ onOpen }) {
  const found = STOPS.filter((s) => s.found).length;
  return (
    <div className="nui-screen">
      <p className="nui-label">Today · New York</p>
      <div className="nui-title-row">
        <h1 className="nui-title">Trip</h1>
        <ProgressRing found={found} total={STOPS.length} />
      </div>
      <p className="nui-meta">
        {found} of {STOPS.length} found
      </p>
      <MaprLine>One stop left. Central Park is 12 minutes on foot from here.</MaprLine>
      <ol className="nui-stops">
        {STOPS.map((s, i) => (
          <li key={s.place.id} className="nui-stop">
            {s.walk && <p className="nui-walk">{s.walk}</p>}
            <button type="button" className="nui-stop-row" onClick={() => onOpen(s.place)}>
              <span className={`nui-stop-num ${s.found ? 'found' : ''}`}>{i + 1}</span>
              <span className="nui-stop-time">{s.time}</span>
              <span className="nui-list-text">
                <span className="nui-row-title">{s.place.name}</span>
                <span className="nui-meta">{s.found ? 'Checked in' : s.place.area}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="nui-btn nui-wide">Add a stop</button>
    </div>
  );
}

function initialMode() {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export default function NewUILab() {
  const [screen, setScreen] = useState('plan');
  const [mode, setMode] = useState(initialMode);
  const [place, setPlace] = useState(PLACES[0]);
  const [back, setBack] = useState('plan');

  const open = (p) => {
    setPlace(p);
    setBack(screen === 'place' ? back : screen);
    setScreen('place');
  };

  return (
    <div className="nui" data-mode={mode}>
      <div className="nui-bar">
        <div className="nui-seg" role="tablist" aria-label="New UI screens">
          {SCREENS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={screen === s.id}
              className={screen === s.id ? 'on' : ''}
              onClick={() => setScreen(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="nui-mode"
          onClick={() => setMode((m) => (m === 'dark' ? 'light' : 'dark'))}
          aria-label={`Show ${mode === 'dark' ? 'light' : 'dark'} mode`}
        >
          {mode === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
      <div className="nui-phone" key={screen}>
        {screen === 'plan' && <PlanScreen onOpen={open} />}
        {screen === 'place' && <PlaceScreen place={place} onBack={() => setScreen(back)} />}
        {screen === 'trip' && <TripScreen onOpen={open} />}
      </div>
      <p className="nui-note">Sample screens built from docs/design-language.md. Nothing here is saved.</p>
    </div>
  );
}
