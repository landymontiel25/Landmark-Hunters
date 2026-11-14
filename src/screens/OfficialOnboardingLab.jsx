import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useGeo } from '../lib/GeoContext';
import { ensurePlacePacks, usePlacePacksVersion } from '../lib/placePacks';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { radiusFor } from '../lib/checkinRules';
import { MaprBubble, MaprSays } from '../components/MaprTutorial';
import ConfettiBurst from '../components/ConfettiBurst';
import { LabSignUp, TutorialTabs } from './SignupTutorialLab';
import { Plan, Prepared } from './ExplainerImagesLab';
import LabSummary from './TutorialSummary';
import { pitchFor } from './officialOnboardingPitches';
import {
  CHECKIN_POINTS,
  CITIES,
  COMMIT,
  INTRO,
  MAX_TASTE,
  MIN_TASTE,
  OO_STEPS,
  OO_TABS,
  OTHER_CITIES,
  SAMPLE_BUILT_TODAY,
  SAY,
  TASTES,
  CATEGORY_DELTA,
  answersFromCats,
  buildDay,
  cityCategories,
  cityById,
  cityName,
  cityScopeKey,
  dayLine,
  lighterDay,
  nearestStop,
  reflectLine,
  routeMeters,
  summaryLines,
  tasteLabel,
} from './officialOnboardingSteps';
import {
  HOMETOWN_SAY,
  QUIET_RULE,
  SAMPLE_VISITED,
  cityPlaces,
  dailyLoop,
  homeAnchor,
  hometownPicks,
  kindIcon,
  pickReason,
  saveLists,
  shockStat,
  visitedSample,
} from './officialOnboardingHometown';

// Test tab "Official Onboarding" (owner, 2026-11-11): the Planner-first
// flow in 9 steps and three acts. Act 1 intro (problem + solution, city,
// taste pick), Act 2 climax (pick the categories you'd like to visit, Mapr
// repeats it back, the first Mapr day, the first check-in with the Always location ask and
// review ask), Act 3 (summary + commitment, then sign-up for the first
// time, with a Map + Itinerary tour). Same shell as the Planner and Game
// tutorials, which stay as they are for comparison. Nothing is saved: no
// account, no rating, no check-in, no city change. The summary shows what a
// real run would have saved. Words and route building: officialOnboardingSteps.js.

const empty = () => ({
  name: '',
  email: '',
  password: '',
  age: false,
  via: null,
  city: null,
  chips: null,
  cats: null, // step 4's picks; until then the taste picks stand in
  notes: '',
  places: [],
  stops: [],
  savedDay: false,
  location: null, // 'prompt' | 'upgrade' | 'always' | 'allowed' (While Using) | 'not-now'
  checkedIn: false,
  review: null, // 'rated' | 'skipped'
  commitment: null,
  lighter: false,
  home: 'miami', // step 10's home city (Test: picked here, a real run knows it)
  homePicks: [],
  homeSaved: null, // the list the 3 hometown picks were saved to
});

// The categories in play: step 4's picks, else step 3's.
const catsOf = (d) => d.cats ?? d.chips ?? [];

function Phone({ children, className = '' }) {
  return <div className={`tut-phone oo-phone ${className}`}>{children}</div>;
}

function NextButton({ onClick, children = 'Next', disabled = false }) {
  return (
    <button type="button" className="btn btn-primary btn-block fr-tap" disabled={disabled} onClick={onClick}>
      {children} {'\u{2192}'}
    </button>
  );
}

function Intro({ onDone }) {
  const [i, setI] = useState(0);
  const screen = INTRO[i];
  return (
    <div className="tut nav-clear">
      <p className="tut-count">
        Screen {i + 1} of {INTRO.length}
      </p>
      <MaprBubble>{screen.say}</MaprBubble>
      <Phone key={i}>
        <div className="tut-hero" aria-hidden="true">
          {screen.hero}
        </div>
      </Phone>
      <NextButton onClick={() => (i === INTRO.length - 1 ? onDone() : setI(i + 1))}>{screen.button}</NextButton>
    </div>
  );
}

function CityPick({ value, onPick }) {
  const [other, setOther] = useState(false);
  return (
    <div className="tut nav-clear">
      <MaprSays lines={SAY.city} />
      <Phone>
        <div className="oo-options" role="radiogroup" aria-label="City">
          {CITIES.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={value === c.id} className={`fr-chip oo-option ${value === c.id ? 'on' : ''}`} onClick={() => onPick(c.id)}>
              {c.label}
            </button>
          ))}
          <button type="button" className={`fr-chip oo-option ${other ? 'on' : ''}`} aria-expanded={other} onClick={() => setOther(!other)}>
            Pick another city
          </button>
          {other && (
            <select className="oo-select" aria-label="Another city" value={OTHER_CITIES.some((c) => c.id === value) ? value : ''} onChange={(e) => e.target.value && onPick(e.target.value)}>
              <option value="">Choose a city</option>
              {OTHER_CITIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </Phone>
    </div>
  );
}

function TastePick({ onNext, onSkip }) {
  const [chips, setChips] = useState([]);
  const toggle = (id) => setChips((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < MAX_TASTE ? [...c, id] : c));
  return (
    <div className="tut nav-clear">
      <MaprSays lines={SAY.taste} />
      <Phone>
        <div className="fr-chips">
          {TASTES.map((i) => (
            <button key={i.id} type="button" className={`fr-chip ${chips.includes(i.id) ? 'on' : ''}`} aria-pressed={chips.includes(i.id)} onClick={() => toggle(i.id)}>
              {i.icon} {i.label}
            </button>
          ))}
        </div>
        <p className="tut-small">
          {chips.length} picked{chips.length < MIN_TASTE ? `, ${MIN_TASTE - chips.length} more to go` : ''}
        </p>
      </Phone>
      <NextButton disabled={chips.length < MIN_TASTE} onClick={() => onNext(chips)} />
      <div className="oo-gap" />
      <button type="button" className="btn btn-ghost btn-block" onClick={onSkip}>
        Skip for now
      </button>
    </div>
  );
}

// Step 4: every category the app has places for in this city, with its icon.
// Starts from the step 3 picks. A tap is a tiny win: +10 on that kind of place.
function CategoryPick({ city, initial, onNext }) {
  const options = cityCategories(city);
  const [picked, setPicked] = useState(initial);
  const [win, setWin] = useState(null);
  const toggle = (c) => {
    const on = picked.includes(c.id);
    setPicked(on ? picked.filter((x) => x !== c.id) : [...picked, c.id]);
    setWin(on ? null : { key: `${c.id}-${picked.length}`, label: c.label });
  };
  return (
    <div className="nav-clear">
      <MaprSays lines={SAY.categories} />
      <div className="oo-progress-row">
        <p className="oo-progress-line" role="status">
          {picked.length} picked
        </p>
        {win && (
          <span key={win.key} className="oo-win up" aria-live="polite">
            +{CATEGORY_DELTA} {win.label}
          </span>
        )}
      </div>
      <div className="oo-cats" role="group" aria-label="Categories you'd like to visit">
        {options.map((c) => (
          <button key={c.id} type="button" className={`oo-cat ${picked.includes(c.id) ? 'on' : ''}`} aria-pressed={picked.includes(c.id)} onClick={() => toggle(c)}>
            <span className="oo-cat-icon" aria-hidden="true">
              {c.icon}
            </span>
            <span className="oo-cat-name">{c.label}</span>
            <span className="oo-cat-count">{c.count} places</span>
          </button>
        ))}
      </div>
      <div className="oo-gap" />
      <NextButton onClick={() => onNext(picked)} />
    </div>
  );
}

function CheckIn({ data, set, coords, pretend, note, onNext }) {
  const { units } = useUnits();
  const nearest = nearestStop(data.stops, coords);
  if (!nearest) return <MaprBubble>Build your day first (step 6).</MaprBubble>;
  const meters = pretend ? 0 : nearest.meters;
  const inside = meters != null && meters <= radiusFor(nearest.place);

  if (!data.location) {
    return (
      <div className="tut nav-clear">
        <MaprSays lines={SAY.primer} />
        <Phone>
          <div className="tut-hero" aria-hidden="true">
            {'\u{1F4CD}'}
          </div>
          <div className="tut-screen-title">Location, Always</div>
          <p className="tut-small">To check you in at {nearest.place.name} and spot places as you pass them.</p>
        </Phone>
        <NextButton
          onClick={() => {
            set({ location: 'prompt' });
            note('Tapped allow on the location primer');
          }}
        >
          Allow location
        </NextButton>
        <button
          type="button"
          className="btn btn-ghost btn-block"
          style={{ marginTop: 10 }}
          onClick={() => {
            set({ location: 'not-now' });
            note('Not now on the location primer');
          }}
        >
          Not now
        </button>
      </div>
    );
  }

  if (data.location === 'prompt') {
    const answer = (how) => {
      set({ location: how === 'deny' ? 'not-now' : how === 'Allow While Using App' ? 'upgrade' : 'allowed' });
      note(how === 'deny' ? "iOS prompt: Don't Allow (pretend)" : `iOS prompt: ${how} (pretend)`);
    };
    return (
      <div className="tut nav-clear">
        <MaprSays lines={SAY.promptFirst} />
        <Phone>
          <div className="tut-dialog">
            <strong>Allow "Landmark Hunters" to use your location?</strong>
            <button type="button" className="tut-dialog-btn oo-dialog-btn" onClick={() => answer('Allow Once')}>
              Allow Once
            </button>
            <button type="button" className="tut-dialog-btn oo-dialog-btn tut-pulse" onClick={() => answer('Allow While Using App')}>
              Allow While Using App
            </button>
            <button type="button" className="tut-dialog-btn oo-dialog-btn" onClick={() => answer('deny')}>
              Don't Allow
            </button>
          </div>
        </Phone>
      </div>
    );
  }

  // iOS's second question, right after While Using: the upgrade to Always.
  if (data.location === 'upgrade') {
    const answer = (always) => {
      set({ location: always ? 'always' : 'allowed' });
      note(always ? 'iOS prompt: Change to Always Allow (pretend)' : 'iOS prompt: Keep Only While Using (pretend)');
    };
    return (
      <div className="tut nav-clear">
        <MaprSays lines={SAY.promptAlways} />
        <Phone>
          <div className="tut-dialog">
            <strong>Allow "Landmark Hunters" to also use your location even when you are not using the app?</strong>
            <button type="button" className="tut-dialog-btn oo-dialog-btn" onClick={() => answer(false)}>
              Keep Only While Using
            </button>
            <button type="button" className="tut-dialog-btn oo-dialog-btn tut-pulse" onClick={() => answer(true)}>
              Change to Always Allow
            </button>
          </div>
        </Phone>
      </div>
    );
  }

  if (data.checkedIn) {
    return (
      <div className="tut nav-clear">
        <div className="oo-celebrate">
          <span className="oo-points">
            +{CHECKIN_POINTS}
            <ConfettiBurst />
          </span>
        </div>
        <MaprSays lines={SAY.checkinWin} />
        {!data.review && (
          <>
            <MaprSays lines={SAY.review} />
            <Phone>
              <div className="tut-dialog">
                <strong>Enjoying Landmark Hunters?</strong>
                <p className="tut-small">Tap a star to rate it on the App Store.</p>
                <div className="oo-stars" role="group" aria-label="Rate the app">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-label={`${n} star${n > 1 ? 's' : ''}`}
                      onClick={() => {
                        set({ review: 'rated' });
                        note(`Rated the app ${n} stars (pretend)`);
                      }}
                    >
                      {'\u{2605}'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="tut-dialog-btn oo-dialog-btn"
                  onClick={() => {
                    set({ review: 'skipped' });
                    note('Skipped the review ask (no nag in session 1)');
                  }}
                >
                  Not Now
                </button>
              </div>
            </Phone>
          </>
        )}
        {data.review && <NextButton onClick={() => onNext('After the first check-in')}>Next</NextButton>}
      </div>
    );
  }

  const away = meters == null ? null : formatDistance(meters, units);
  return (
    <div className="tut nav-clear">
      <MaprBubble>
        {data.location === 'not-now' || meters == null
          ? `Check in at ${nearest.place.name} when you're there.`
          : inside
            ? `You're at ${nearest.place.name}. Check in now.`
            : `You're ${away} away — check in when you're there.`}
      </MaprBubble>
      <Phone>
        <div className="fr-checkin">
          <strong className="fr-place">{nearest.place.name}</strong>
          {away && (
            <p className={`fr-pill ${inside ? 'here' : ''}`} role="status">
              {inside ? "You're here" : `${away} away`}
            </p>
          )}
        </div>
      </Phone>
      {inside && (data.location === 'always' || data.location === 'allowed') && (
        <NextButton
          onClick={() => {
            set({ checkedIn: true });
            note(`Checked in at ${nearest.place.name}, +${CHECKIN_POINTS} (pretend)`);
          }}
        >
          Check in now
        </NextButton>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-block"
        style={{ marginTop: 10 }}
        onClick={() => onNext(`Skipped check-in; day saved, ${nearest.place.name} is the Day 2 hook`)}
      >
        Skip for now
      </button>
    </div>
  );
}

function Commit({ data, set, note, onNext }) {
  const pick = COMMIT.find((c) => c.id === data.commitment);
  return (
    <div className="tut nav-clear">
      <MaprSays lines={summaryLines({ city: cityById(data.city), chips: catsOf(data) })} />
      <MaprSays lines={SAY.commitAsk} />
      <div className="oo-options" role="radiogroup" aria-label="How committed are you?">
        {COMMIT.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={data.commitment === c.id}
            className={`fr-chip oo-option ${data.commitment === c.id ? 'on' : ''}`}
            onClick={() => {
              set({ commitment: c.id });
              note(`Commitment: ${c.label}`);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      {pick && <MaprSays lines={pick.low ? SAY.commitLow : SAY.commitHigh} />}
      {pick?.low && !data.lighter && data.stops.length > 2 && (
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => {
            const stops = lighterDay(data.stops);
            set({ stops, lighter: true });
            note(`Rebuilt a lighter day: ${stops.map((s) => s.name).join(' → ')}`);
          }}
        >
          Make my day lighter
        </button>
      )}
      {data.lighter && <p className="oo-proof">{dayLine(cityById(data.city), data.stops)}</p>}
      <p className="oo-proof">
        {SAMPLE_BUILT_TODAY} people built a day like this today. <small>(sample number in Test)</small>
      </p>
      <NextButton disabled={!pick} onClick={() => onNext('Answered commitment')} />
    </div>
  );
}

function SignUp({ data, set, note, onDone }) {
  const [phase, setPhase] = useState(data.via ? 'tabs' : 'form');
  if (phase === 'form') {
    return (
      <div className="nav-clear">
        <MaprSays lines={SAY.signup} />
        <LabSignUp
          googleFirst
          data={data}
          set={set}
          onDone={(via) => {
            set({ via });
            note(`Signed up (${via}, pretend)`);
            setPhase('tabs');
          }}
        />
      </div>
    );
  }
  if (phase === 'tabs') {
    return (
      <div>
        {data.via === 'email' && (
          <p className="oo-verify" role="note">
            {'\u{1F4E7}'} {SAY.verifyLater[0]}
          </p>
        )}
        <TutorialTabs
          stops={OO_TABS}
          onDone={() => {
            note('Finished the Map + Itinerary tour');
            setPhase('hook');
          }}
        />
      </div>
    );
  }
  return (
    <div className="tut nav-clear">
      <Phone>
        <div className="tut-hero" aria-hidden="true">
          {'\u{1F305}'}
        </div>
      </Phone>
      <MaprSays lines={SAY.hook} />
      <NextButton onClick={onDone}>Finish</NextButton>
    </div>
  );
}

const HOME_STILL = { dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomControl: false };
const pickIcon = (n) => L.divIcon({ className: 'oo-home-pick', html: `<span>${n}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
// A plain gray map, so the grey pins carry it; the same Esri tile server as the route map.
const tilesFor = () =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light' ? 'Light' : 'Dark'}_Gray_Base/MapServer/tile/{z}/{y}/{x}`;

// Step 10, Hometown Transition (owner, 2026-11-14): the home city's map,
// grey pins for every place not visited yet, the count in their own
// numbers, 3 picks near them from the same taste and category picks, and
// the daily companion loop. Nothing is saved.
function Hometown({ data, set, coords, note, onDone }) {
  const { units } = useUnits();
  const packs = usePlacePacksVersion();
  useEffect(() => {
    ensurePlacePacks();
  }, []);
  const city = cityById(data.home) || CITIES[0];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const places = useMemo(() => cityPlaces(city), [city, packs]);
  const visited = useMemo(() => visitedSample(places), [places]);
  const anchor = homeAnchor(places, visited, coords);
  const picks = useMemo(() => hometownPicks(places, visited, catsOf(data), anchor), [places, visited, data.cats, data.chips, anchor?.lat, anchor?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  const seen = new Set(visited.map((l) => l.id));
  const pickIds = new Set(picks.map((p) => p.place.id));
  const bounds = places.length ? L.latLngBounds(places.map((l) => [l.lat, l.lng])) : null;
  const loop = dailyLoop(picks[0]?.place, CHECKIN_POINTS);
  const save = (list) => {
    set({ homeSaved: list.label, homePicks: picks.map((p) => p.place.name) });
    note(`Saved ${picks.map((p) => p.place.name).join(', ')} to "${list.label}" (pretend)`);
  };

  return (
    <div className="tut nav-clear oo-home">
      <h2 className="oo-section-title">Official Onboarding: Hometown Transition</h2>
      <label className="oo-home-city">
        Home city <small>(Test only)</small>
        <select
          className="oo-select"
          value={city.id}
          onChange={(e) => {
            set({ home: e.target.value, homeSaved: null, homePicks: [] });
            note(`Home city: ${cityById(e.target.value).label}`);
          }}
        >
          {[...CITIES, ...OTHER_CITIES].map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <Phone className="oo-home-phone">
        {bounds && (
          <MapContainer key={`${city.id}-${places.length}`} className="oo-home-map" bounds={bounds} boundsOptions={{ padding: [18, 18] }} zoomSnap={0.1} attributionControl={false} {...HOME_STILL}>
            <TileLayer url={tilesFor()} maxZoom={16} />
            {/* Grey first, so the gold "been there" dots sit on top. */}
            {[...places.filter((l) => !pickIds.has(l.id) && !seen.has(l.id)), ...visited]
              .map((l) => (
                <CircleMarker
                  key={l.id}
                  center={[l.lat, l.lng]}
                  radius={seen.has(l.id) ? 5 : 3}
                  pathOptions={seen.has(l.id) ? { color: '#ffffff', weight: 1.5, fillColor: '#c9971a', fillOpacity: 1 } : { stroke: false, fillColor: '#9a9a9a', fillOpacity: 0.75 }}
                />
              ))}
            {picks.map((p, i) => (
              <Marker key={p.place.id} position={[p.place.lat, p.place.lng]} icon={pickIcon(i + 1)} title={p.place.name} />
            ))}
          </MapContainer>
        )}
        <p className="oo-home-legend">
          <span className="oo-dot grey" /> Not yet <span className="oo-dot gold" /> Been there
        </p>
      </Phone>

      <p className="oo-home-stat" role="status">
        {shockStat(city, Math.min(SAMPLE_VISITED, visited.length), places.length)}
      </p>
      <p className="tut-small oo-home-sample">"Been to" is a sample in Test: the {SAMPLE_VISITED} best known places. A real run counts your own check-ins.</p>

      <MaprSays lines={HOMETOWN_SAY} />

      <div className="oo-home-picks" role="list" aria-label="Hometown picks">
        {picks.map((p, i) => (
          <div key={p.place.id} className="oo-home-pick-row" role="listitem">
            <span className="oo-home-num">{i + 1}</span>
            <span className="oo-home-text">
              <strong>{p.place.name}</strong>
              <span>
                {kindIcon(p.kind)} {pickReason(p.kind)}
                {p.meters != null && ` · ${formatDistance(p.meters, units)}${anchor?.here ? ' from you' : ''}`}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="oo-home-save" role="group" aria-label="Save the 3 picks">
        {saveLists(city).map((list) => (
          <button key={list.id} type="button" className={`fr-chip oo-option ${data.homeSaved === list.label ? 'on' : ''}`} aria-pressed={data.homeSaved === list.label} onClick={() => save(list)}>
            {data.homeSaved === list.label ? `\u{2713} Saved to ${list.label}` : `Save to ${list.label}`}
          </button>
        ))}
      </div>

      <h3 className="oo-home-h3">Every day, Mapr comes with you</h3>
      <ol className="oo-loop">
        {loop.map((s) => (
          <li key={s.id}>
            <span className="oo-loop-when">{s.when}</span>
            <span className="oo-loop-what">{s.what}</span>
            <span className="oo-loop-note">{s.sample}</span>
          </li>
        ))}
      </ol>
      <p className="oo-proof">{QUIET_RULE}</p>

      <NextButton onClick={onDone}>Show me my city</NextButton>
    </div>
  );
}

export default function OfficialOnboardingLab() {
  const { coords } = useGeo();
  const { units } = useUnits();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [data, setData] = useState(empty);
  const [log, setLog] = useState([]);
  const [pretend, setPretend] = useState(false);
  const set = (patch) => setData((d) => ({ ...d, ...patch }));
  const note = (text) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} — ${text}`]);
  const labelOf = (i) => (i === OO_STEPS.length ? 'Done' : OO_STEPS[i].label);
  const go = (target, why) => {
    const i = typeof target === 'string' ? (target === 'done' ? OO_STEPS.length : OO_STEPS.findIndex((s) => s.id === target)) : target;
    const next = Math.max(0, Math.min(OO_STEPS.length, i));
    note(`${why}: ${labelOf(done ? OO_STEPS.length : step)} → ${labelOf(next)}`);
    setDone(next === OO_STEPS.length);
    setStep(Math.min(next, OO_STEPS.length - 1));
    // The first Mapr pick builds when you reach it, from what's picked so far.
    if (next >= 5 && next < OO_STEPS.length) setData((d) => (d.stops.length ? d : { ...d, stops: buildDay(cityById(d.city) || CITIES[0], catsOf(d), []) }));
  };
  const restart = () => {
    setData(empty());
    setLog([]);
    setDone(false);
    setStep(0);
  };

  const id = done ? 'done' : OO_STEPS[step].id;
  const city = cityById(data.city);
  const deckCity = city || CITIES[0];

  return (
    <div>
      <div className="card section lab-controls">
        <div className="lab-controls-head">
          <strong>{'\u{1F9EA}'} Official Onboarding test</strong>
          <span className="tag">Nothing here is saved</span>
        </div>
        <div className="lab-steps">
          {OO_STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`lab-step ${!done && i === step ? 'active' : ''} ${done || i < step ? 'done' : ''}`}
              title={`Act ${s.act}`}
              onClick={() => go(i, 'Jumped')}
            >
              {i + 1}. {s.label}
            </button>
          ))}
        </div>
        <div className="lab-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={restart}>
            {'\u{21BA}'} Restart
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={step === 0 && !done} onClick={() => go(done ? OO_STEPS.length - 1 : step - 1, 'Back')}>
            {'\u{2190}'} Back
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={done} onClick={() => go(step + 1, 'Next step')}>
            Next step {'\u{2192}'}
          </button>
        </div>
        <div className="lab-actions" style={{ marginTop: 8 }}>
          <label className="fr-toggle">
            <input type="checkbox" checked={pretend} onChange={(e) => setPretend(e.target.checked)} /> Pretend I'm at the place
          </label>
        </div>
      </div>

      {!done && <p className="oo-act">Act {OO_STEPS[step].act}</p>}

      {id === 'intro' && <Intro onDone={() => go('city', 'Watched the 3 intro screens')} />}
      {id === 'city' && (
        <>
          <CityPick
            value={data.city}
            onPick={(c) => {
              // A new city means a new list of categories and a new day.
              set({ city: c, stops: [] });
              note(`Picked ${cityById(c).label}: Map, Landmarks, Mapr and Itinerary open on ${cityScopeKey(cityById(c))} (pretend)`);
            }}
          />
          <NextButton disabled={!data.city} onClick={() => go('taste', `City: ${city?.label}`)} />
        </>
      )}
      {id === 'taste' && (
        <TastePick
          onNext={(chips) => {
            set({ chips, cats: null, stops: [] });
            go('categories', `Picked ${chips.map(tasteLabel).join(', ')}`);
          }}
          onSkip={() => {
            set({ chips: [], cats: null, stops: [] });
            go('categories', 'Skipped taste pick');
          }}
        />
      )}
      {id === 'categories' && (
        <CategoryPick
          key={`${data.city}-${(data.chips || []).join(',')}`}
          city={city || deckCity}
          initial={catsOf(data)}
          onNext={(cats) => {
            set({ cats, stops: [] });
            go('reflect', cats.length ? `Picked ${cats.length} categories: ${cats.map(tasteLabel).join(', ')} (+${CATEGORY_DELTA} each)` : 'Picked no categories');
          }}
        />
      )}
      {id === 'reflect' && (
        <div className="nav-clear">
          <MaprBubble>{reflectLine(catsOf(data))}</MaprBubble>
          <MaprSays lines={SAY.notes} />
          <textarea
            className="rating-comment"
            aria-label="Anything else you love or hate"
            rows={4}
            maxLength={2000}
            placeholder="Optional, in your own words"
            value={data.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
          <p className="tut-small" style={{ margin: '6px 0 14px' }}>
            Kept word for word and passed to Mapr on every surface. Never turned into tags.
          </p>
          <NextButton onClick={() => go('route', data.notes.trim() ? 'Added notes' : 'No notes')}>{data.notes.trim() ? 'Save & build my day' : 'Build my day'}</NextButton>
        </div>
      )}
      {id === 'route' && (
        <div className="nav-clear">
          {data.stops.length >= 2 ? (
            <>
              <MaprBubble>
                {dayLine(city || deckCity, data.stops)}. {data.stops.length} stops · {formatDistance(routeMeters(data.stops), units)}
              </MaprBubble>
              <div className="oo-intro">
                <Plan places={data.stops} keepOrder title={`Your ${cityName(city || deckCity)} day`} />
              </div>
              <MaprBubble>Arrive prepared at {data.stops[0].name}. {pitchFor(data.stops[0])}</MaprBubble>
              <div className="oo-intro">
                <Prepared places={[data.stops[0]]} />
              </div>
            </>
          ) : (
            <MaprBubble>I couldn't build a day here yet. Pick a city with more places.</MaprBubble>
          )}
          <NextButton
            onClick={() => {
              set({ savedDay: true });
              go('checkin', 'Saved the day (pretend)');
            }}
          >
            Save this day
          </NextButton>
        </div>
      )}
      {id === 'checkin' && <CheckIn data={data} set={set} coords={coords} pretend={pretend} note={note} onNext={(why) => go('commit', why)} />}
      {id === 'commit' && <Commit data={data} set={set} note={note} onNext={(why) => go('signup', why)} />}
      {id === 'signup' && <SignUp data={data} set={set} note={note} onDone={() => go('hometown', 'Finished sign-up')} />}
      {id === 'hometown' && <Hometown data={data} set={set} coords={coords} note={note} onDone={() => go('done', 'Show me my city')} />}
      {id === 'done' && (
        <>
          <MaprSays lines={SAY.done} />
          <LabSummary data={{ ...data, cards: [], answers: answersFromCats(catsOf(data)), skippedRating: !catsOf(data).length }} log={log} onRestart={restart} showPlaces={false} categories>
            <p>
              <strong>City:</strong> {city ? `${city.label} (${cityScopeKey(city)} on Map, Landmarks, Mapr and Itinerary)` : '—'}
            </p>
            <p>
              <strong>Mapr's day:</strong> {data.stops.length ? `${data.stops.map((s) => s.name).join(' → ')}${data.savedDay ? ' (saved)' : ''}` : '—'}
            </p>
            <p>
              <strong>Location:</strong> {data.location === 'always' ? 'Always' : data.location === 'allowed' ? 'While Using the App' : data.location === 'not-now' ? 'not now' : '—'}
              {' · '}
              <strong>Review ask:</strong> {data.review || '—'}
            </p>
            <p>
              <strong>Commitment:</strong> {COMMIT.find((c) => c.id === data.commitment)?.label || '—'}
              {data.lighter ? ' (rebuilt a lighter day)' : ''}
            </p>
            <p>
              <strong>Hometown:</strong> {cityById(data.home)?.label || '—'}
              {' · '}
              <strong>Picks:</strong> {data.homePicks.length ? `${data.homePicks.join(', ')} (saved to ${data.homeSaved})` : 'not saved'}
            </p>
          </LabSummary>
        </>
      )}
    </div>
  );
}
