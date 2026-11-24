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
import { Plan, Prepared, RouteMap } from './ExplainerImagesLab';
import LabSummary from './TutorialSummary';
import { pitchFor } from './officialOnboardingPitches';
import { requestAppReview } from '../lib/appReview';
import {
  CHECKIN_POINTS,
  CITIES,
  TRAVELER_QUESTIONS,
  reviewDeclined,
  setReviewDeclined,
  INTRO,
  OO_STEPS,
  OO_TABS,
  OTHER_CITIES,
  SAMPLE_BUILT_TODAY,
  SAY,
  CATEGORY_DELTA,
  answersFromCats,
  buildDay,
  cityCategories,
  cityById,
  cityName,
  cityScopeKey,
  dayLine,
  nearestStop,
  reflectLine,
  routeMeters,
  summaryLines,
  tasteLabel,
} from './officialOnboardingSteps';
import {
  hometownNotification,
  hometownSay,
  QUIET_RULE,
  SAMPLE_VISITED,
  cityPlaces,
  dailyLoop,
  homeAnchor,
  hometownPicks,
  HOMETOWN_TITLE,
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
// review ask), Act 3 (summary + a traveler question, then sign-up for the
// first time, with a tour of every tab). Same shell as the Planner and Game
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
  traveler: {}, // the summary's traveler question(s): { kind, day, pace, when }
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
      <Phone key={i} className={screen.image || screen.map ? 'oo-intro-card' : ''}>
        {screen.image && <img className={`oo-intro-img ${screen.photo ? 'photo' : ''}`} src={screen.image} alt={screen.alt} />}
        {screen.map && <IntroMap />}
      </Phone>
      <NextButton onClick={() => (i === INTRO.length - 1 ? onDone() : setI(i + 1))}>{screen.button}</NextButton>
    </div>
  );
}

// Intro screen 3: the real map (satellite, the city's places as pins) with
// a real 3-stop Mapr day drawn as a blue route, the map's own blue (owner,
// 2026-11-14: was gold). Miami until a city is picked.
function IntroMap() {
  const packs = usePlacePacksVersion();
  useEffect(() => {
    ensurePlacePacks();
  }, []);
  const city = CITIES[0];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stops = useMemo(() => buildDay(city, ['history-culture', 'food', 'parks-nature'], []), [packs]);
  const others = useMemo(() => {
    if (stops.length < 2) return [];
    const box = L.latLngBounds(stops.map((st) => [st.lat, st.lng])).pad(0.6);
    const ids = new Set(stops.map((st) => st.id));
    return cityPlaces(city).filter((l) => !ids.has(l.id) && box.contains([l.lat, l.lng])).slice(0, 120);
  }, [stops]); // eslint-disable-line react-hooks/exhaustive-deps
  if (stops.length < 2) return null;
  return (
    <div className="oo-intro-map" role="img" aria-label={`A real Mapr day in ${cityName(city)}: ${stops.map((st) => st.name).join(', then ')}`}>
      <RouteMap stops={stops} others={others} color="#0a84ff" className="intro-map oo-intro-map-inner" untangle onOpen={() => {}} />
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

// Step 3: every category the app has places for in this city, with its icon
// (it replaced the taste pick, owner 2026-11-15). A tap is a tiny win: +10 on
// that kind of place.
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
            <strong>Allow "Landmark Hunters" to also use your location even when you're not using the app?</strong>
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
        {/* TRIAL: the switch always shows here (owner, 2026-11-15: it hid
            after "Not yet" or an answer, so the trial was hard to find). */}
        {!data.review && !reviewDeclined() && <ReviewAsk set={set} note={note} />}
        {(data.review === 'rated' || data.review === 'previewed') && <MaprSays lines={SAY.reviewThanks} />}
        {data.review === 'previewed' && (
          <p className="tut-small oo-review-note" role="note">
            {SAY.reviewPreviewNote}
          </p>
        )}
        {(data.review || reviewDeclined()) && <NextButton onClick={() => onNext('After the first check-in')}>Next</NextButton>}
        {data.review !== 'rated' && data.review !== 'previewed' && reviewDeclined() && (
          <button
            type="button"
            className="oo-review-reset"
            onClick={() => {
              setReviewDeclined(false);
              set({ review: null });
              note('Showed the review ask again (Test only)');
            }}
          >
            Show the ask again (Test only)
          </button>
        )}
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
            : `You're ${away} away. Check in when you're there.`}
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

// The summary (owner, 2026-11-14): Mapr's two lines, then a traveler
// question instead of a commitment one (there's no commitment in
// traveling). All four questions show until the owner picks one.
// The review ask (owner, 2026-11-15), at the peak: right after the first
// check-in win, never at launch. "Yes, I love it" opens Apple's own review
// prompt (requestAppReview), nothing of ours: no stars, no comment box, no
// Submit, and never "five stars" by name, so the App Store build passes
// review. In a browser there's no system prompt, so Test says what would
// happen. "Not yet" skips it and it isn't asked again this session.

function ReviewAsk({ set, note }) {
  return (
    <>
      <MaprSays lines={SAY.review} />
      <div className="oo-options oo-review-ask" role="group" aria-label="Leave a review?">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={async () => {
            const { shown, reason } = await requestAppReview();
            set({ review: shown ? 'rated' : 'previewed' });
            note(shown ? "Asked Apple's review prompt (Apple decides if it shows)" : `Yes to the review ask: Apple's prompt would open here (${reason === 'web' ? 'not on the web' : 'not available'})`);
          }}
        >
          Yes, I love it
        </button>
        <button
          type="button"
          className="fr-chip oo-option"
          onClick={() => {
            setReviewDeclined(true);
            set({ review: 'skipped' });
            note('Not yet on the review ask (not asked again this session)');
          }}
        >
          Not yet
        </button>
      </div>
    </>
  );
}

function Commit({ data, set, note, onNext }) {
  const answers = data.traveler || {};
  return (
    <div className="tut nav-clear">
      <MaprSays lines={summaryLines({ city: cityById(data.city) || CITIES[0], chips: catsOf(data), loved: data.loved || [], stops: data.stops })} />
      {TRAVELER_QUESTIONS.map((q) => (
        <div key={q.id} className="oo-question">
          <MaprSays lines={[q.ask]} />
          <div className="oo-options" role="radiogroup" aria-label={q.ask}>
            {q.options.map((label) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={answers[q.id] === label}
                className={`fr-chip oo-option ${answers[q.id] === label ? 'on' : ''}`}
                onClick={() => {
                  set({ traveler: { ...answers, [q.id]: label } });
                  note(`${q.ask} ${label}`);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="oo-proof">
        {SAMPLE_BUILT_TODAY} people built a day like this today. <small>(sample number in Test)</small>
      </p>
      <NextButton onClick={() => onNext(Object.keys(answers).length ? 'Answered the traveler question' : 'Skipped the traveler question')} />
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
            note('Finished the tab tour');
            setPhase('hook');
          }}
        />
      </div>
    );
  }
  return (
    <div className="tut nav-clear">
      {/* The owner's picture (owner, 2026-11-14): a traveler with a backpack
          and a map on the phone, gold pins down a sunset street. Full size. */}
      <figure className="oo-hook-photo">
        <img
          src="/onboarding/onboarding-see-you-tomorrow.jpg"
          alt="A traveler with a backpack looks at a map on their phone while gold pins float down a city street at sunset."
          width="820"
          height="1024"
          decoding="async"
        />
      </figure>
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
// Act 3 (owner, 2026-11-14): onboarding only asks where home is, so Mapr
// knows it for later. No pitch here.
function HomeAsk({ data, set, note, onNext }) {
  const all = [...CITIES, ...OTHER_CITIES];
  return (
    <div className="tut nav-clear">
      <MaprSays lines={SAY.home} />
      <div className="oo-options" role="radiogroup" aria-label="Your hometown">
        {CITIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={data.home === c.id}
            className={`fr-chip oo-option ${data.home === c.id ? 'on' : ''}`}
            onClick={() => {
              set({ home: c.id, homeSaved: null, homePicks: [] });
              note(`Hometown: ${c.label} (saved to the profile in a real run)`);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <label className="oo-home-city">
        Somewhere else
        <select
          className="oo-select"
          value={CITIES.some((c) => c.id === data.home) ? '' : data.home}
          onChange={(e) => {
            if (!e.target.value) return;
            set({ home: e.target.value, homeSaved: null, homePicks: [] });
            note(`Hometown: ${cityById(e.target.value).label} (saved to the profile in a real run)`);
          }}
        >
          <option value="">Pick a city</option>
          {all
            .filter((c) => !CITIES.includes(c))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
        </select>
      </label>
      <NextButton disabled={!data.home} onClick={onNext}>
        Finish
      </NextButton>
    </div>
  );
}

// Act 4, after the trip (owner, 2026-11-14): once they are back home, Mapr
// sends ONE notification. Tapping it opens the Hometown Transition screen.
function BackHome({ data, note, onOpen }) {
  const packs = usePlacePacksVersion();
  useEffect(() => {
    ensurePlacePacks();
  }, []);
  const city = cityById(data.home) || CITIES[0];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const places = useMemo(() => cityPlaces(city), [city, packs]);
  const visited = Math.min(SAMPLE_VISITED, visitedSample(places).length);
  return (
    <div className="tut nav-clear">
      <p className="tut-small oo-later">Later, after a trip. Once you're back in {cityName(city)}, I'll send you this one notification, and only once.</p>
      <div className="oo-lock">
        <p className="oo-lock-time">9:41</p>
        <button
          type="button"
          className="oo-notif"
          onClick={() => {
            note('Opened the back-home notification');
            onOpen();
          }}
        >
          <span className="oo-notif-icon" aria-hidden="true">
            <img src="/logo.png" alt="" />
          </span>
          <span className="oo-notif-body">
            <span className="oo-notif-head">
              <strong>Landmark Hunters</strong>
              <span>now</span>
            </span>
            <span className="oo-notif-text">{hometownNotification(city, visited, places.length)}</span>
          </span>
        </button>
      </div>
      <p className="tut-small oo-later">Tap the notification to open it.</p>
    </div>
  );
}

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
        You've been to {shockStat(city, Math.min(SAMPLE_VISITED, visited.length), places.length)}.
      </p>
      <p className="tut-small oo-home-sample">"Been to" is a sample in Test: the {SAMPLE_VISITED} best known places. A real run counts your own check-ins.</p>

      <MaprSays lines={hometownSay(city, Math.min(SAMPLE_VISITED, visited.length), places.length)} />

      <h3 className="oo-home-h3">{HOMETOWN_TITLE}</h3>
      <div className="oo-home-picks" role="list" aria-label={HOMETOWN_TITLE}>
        {picks.map((p, i) => (
          <div key={p.place.id} className="oo-home-pick-row" role="listitem">
            <span className="oo-home-num">{i + 1}</span>
            <span className="oo-home-text">
              <strong>{p.place.name}</strong>
              <span>
                {kindIcon(p.kind)} {pickReason(p.kind, catsOf(data))}
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

      <h3 className="oo-home-h3">Every day, I come with you</h3>
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
  const note = (text) => setLog((l) => [...l, `${new Date().toLocaleTimeString()}: ${text}`]);
  const labelOf = (i) => (i === OO_STEPS.length ? 'Done' : OO_STEPS[i].label);
  const go = (target, why) => {
    const i = typeof target === 'string' ? (target === 'done' ? OO_STEPS.length : OO_STEPS.findIndex((s) => s.id === target)) : target;
    const next = Math.max(0, Math.min(OO_STEPS.length, i));
    note(`${why}: ${labelOf(done ? OO_STEPS.length : step)} → ${labelOf(next)}`);
    setDone(next === OO_STEPS.length);
    setStep(Math.min(next, OO_STEPS.length - 1));
    // The first Mapr pick builds when you reach it, from what's picked so far.
    if (next >= OO_STEPS.findIndex((st) => st.id === 'route') && next < OO_STEPS.length) setData((d) => (d.stops.length ? d : { ...d, stops: buildDay(cityById(d.city) || CITIES[0], catsOf(d), []) }));
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
          <NextButton disabled={!data.city} onClick={() => go('categories', `City: ${city?.label}`)} />
        </>
      )}
      {id === 'categories' && (
        <CategoryPick
          key={data.city || 'none'}
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
            I keep your words exactly as you wrote them and use them everywhere I help you. They never get turned into tags.
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
                <Plan places={data.stops} keepOrder untangle title={`Your ${cityName(city || deckCity)} day`} />
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
      {id === 'signup' && <SignUp data={data} set={set} note={note} onDone={() => go('home', 'Finished sign-up')} />}
      {id === 'home' && <HomeAsk data={data} set={set} note={note} onNext={() => go('notify', `Hometown: ${cityById(data.home)?.label}`)} />}
      {id === 'notify' && <BackHome data={data} note={note} onOpen={() => go('hometown', 'Tapped the back-home notification')} />}
      {id === 'hometown' && <Hometown data={data} set={set} coords={coords} note={note} onDone={() => go('done', 'Show me my city')} />}
      {id === 'done' && (
        <>
          <MaprSays lines={SAY.done} />
          <LabSummary data={{ ...data, cards: [], answers: answersFromCats(catsOf(data)), skippedRating: !catsOf(data).length }} log={log} onRestart={restart} showPlaces={false} categories>
            <p>
              <strong>City:</strong> {city ? `${city.label} (${cityScopeKey(city)} on Map, Landmarks, Mapr and Itinerary)` : 'None'}
            </p>
            <p>
              <strong>Mapr's day:</strong> {data.stops.length ? `${data.stops.map((s) => s.name).join(' → ')}${data.savedDay ? ' (saved)' : ''}` : 'None'}
            </p>
            <p>
              <strong>Location:</strong> {data.location === 'always' ? 'Always' : data.location === 'allowed' ? 'While Using the App' : data.location === 'not-now' ? 'not now' : 'None'}
              {' · '}
              <strong>Review ask:</strong> {data.review || 'None'}
            </p>
            <p>
              <strong>Traveler:</strong>{' '}
              {TRAVELER_QUESTIONS.filter((q) => data.traveler[q.id]).map((q) => `${q.ask} ${data.traveler[q.id]}`).join(' · ') || 'None'}
            </p>
            <p>
              <strong>Hometown:</strong> {cityById(data.home)?.label || 'None'}
              {' · '}
              <strong>Picks:</strong> {data.homePicks.length ? `${data.homePicks.join(', ')} (saved to ${data.homeSaved})` : 'not saved'}
            </p>
          </LabSummary>
        </>
      )}
    </div>
  );
}
