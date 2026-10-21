import { useEffect, useReducer, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useGeo } from '../lib/GeoContext';
import { useRatings } from '../lib/RatingsContext';
import { useTrip } from '../lib/TripContext';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { ALL_LANDMARKS, PICKABLE_INTERESTS } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import { TIERS } from '../lib/ratingFlow';
import ConfettiBurst from '../components/ConfettiBurst';
import {
  CHECKIN_METERS,
  NO_SKIP,
  ORDER,
  PROGRESS_GOAL,
  SIGNUP_TRIGGERS,
  SWIPES,
  firstRunReducer,
  loadFirstRun,
  saveFirstRun,
} from '../lib/firstRun';
import { COPY } from './firstRunCopy';
import { LabSignUp, TabScreen, TutorialLocation, TutorialTabs, TutorialVerify } from './SignupTutorialLab';

// Test tab "Tutorial 2": the owner's First-Run Tutorial Build Guide as a
// sandbox, with onboarding around it in order (ORDER in lib/firstRun.js):
// sign up, verify email, welcome sheet on the Map, taste chips, three swipe
// cards (Interested, Not sure, Not for me) with one rating, first check-in
// with a distance pill, progress ring, location, your tabs. The sign-up prompt opens
// from its triggers. Skip and Skip all on every step but sign-up and verify,
// one tap. The sign-up form, location and tabs steps are the same pieces
// Tutorial 1 uses (SignupTutorialLab.jsx), with its Mapr lines.
// Nothing reaches Firestore: ratings and check-ins are pretend, analytics
// events go to the on-screen log, and progress is kept on this device per
// account (lib/firstRun.js). The words are in firstRunCopy.js.

const MIN_CHIPS = 3;
const MAX_CHIPS = 5;
const MAP_STOP = { path: '/', tab: 'Map', icon: '\u{1F310}' };
const STEP_LABELS = {
  signup: 'Sign up',
  verify: 'Verify email',
  welcome: 'Welcome',
  taste: 'Taste pick',
  swipe: 'Swipe',
  checkin: 'First check-in',
  progress: 'Progress',
  location: 'Location',
  tabs: 'Your tabs',
  done: 'Done',
};
const emptyForm = () => ({ name: '', email: '', password: '', age: false });

const secsSince = (t) => Math.round((Date.now() - t) / 1000);
const radiusOf = (place) => place?.checkInRadiusMeters || CHECKIN_METERS;

// Three real places for the cards: the closest ones with a photo, or the
// most popular when there's no location.
function pickCards(coords) {
  const withPhoto = ALL_LANDMARKS.filter((l) => l.images?.length);
  const ranked = coords
    ? withPhoto.map((l) => ({ l, d: distanceMeters(coords.lat, coords.lng, l.lat, l.lng) })).sort((a, b) => a.d - b.d).map((x) => x.l)
    : [...withPhoto].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  return ranked.slice(0, SWIPES);
}

function nearestPlace(coords) {
  if (!coords) return null;
  let best = null;
  for (const l of ALL_LANDMARKS) {
    const meters = distanceMeters(coords.lat, coords.lng, l.lat, l.lng);
    if (!best || meters < best.meters) best = { place: l, meters };
  }
  return best;
}

function SkipBar({ onSkip, onSkipAll }) {
  return (
    <div className="fr-skipbar">
      <button type="button" className="fr-link" onClick={onSkipAll}>
        {COPY.skipAll}
      </button>
      <button type="button" className="fr-link" onClick={onSkip}>
        {COPY.skipStep}
      </button>
    </div>
  );
}

function WelcomeSheet({ onShow, onSkip }) {
  return (
    <div className="tut-phone fr-map">
      <TabScreen stop={MAP_STOP} />
      <div className="fr-sheet" role="dialog" aria-label={COPY.welcome.title}>
        <h2 className="fr-title">{COPY.welcome.title}</h2>
        <button type="button" className="btn btn-primary btn-block fr-tap" onClick={onShow}>
          {COPY.welcome.button}
        </button>
        <button type="button" className="fr-link fr-tap" onClick={onSkip}>
          {COPY.welcome.skip}
        </button>
      </div>
    </div>
  );
}

function TasteChips({ saved, onNext }) {
  const [chips, setChips] = useState([]);
  const toggle = (id) =>
    setChips((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < MAX_CHIPS ? [...c, id] : c));
  return (
    <div>
      <h2 className="fr-title">{COPY.taste.title}</h2>
      <p className="fr-sub">{COPY.taste.sub}</p>
      <div className="fr-chips">
        {PICKABLE_INTERESTS.map((i) => (
          <button
            key={i.id}
            type="button"
            className={`fr-chip ${chips.includes(i.id) ? 'on' : ''}`}
            aria-pressed={chips.includes(i.id)}
            onClick={() => toggle(i.id)}
          >
            {i.icon} {i.label}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-primary btn-block fr-tap" disabled={chips.length < MIN_CHIPS} onClick={() => onNext(chips)}>
        {COPY.taste.button}
      </button>
      {saved.length > 0 && (
        <button type="button" className="btn btn-ghost btn-block fr-tap" style={{ marginTop: 10 }} onClick={() => onNext(saved)}>
          {COPY.taste.usePrefs}
        </button>
      )}
    </div>
  );
}

const SWIPE_PX = 90;

// One card at a time: drag right or left, or the three buttons. The animated
// hint shows on card one only (static under reduced motion).
function SwipeDeck({ card, index, onSwipe }) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const start = useRef(null);
  // A ref, not just state: two fast taps land before the re-render, and each
  // card must count once.
  const decided = useRef(false);
  const decide = (dir) => {
    if (decided.current) return;
    decided.current = true;
    setLeaving(true);
    setDx(dir === 'interested' ? 600 : dir === 'not_for_me' ? -600 : 0);
    setTimeout(() => onSwipe(dir), 220);
  };
  const up = (e) => {
    if (!start.current) return;
    const moved = e.clientX - start.current;
    start.current = null;
    if (moved > SWIPE_PX) decide('interested');
    else if (moved < -SWIPE_PX) decide('not_for_me');
    else setDx(0);
  };
  return (
    <div>
      <h2 className="fr-title">{COPY.swipe.title}</h2>
      {index === 0 && (
        <p className="fr-hint" role="note">
          <span className="fr-hint-arrow" aria-hidden="true">
            {'\u{1F449}'}
          </span>{' '}
          {COPY.swipe.hint}
        </p>
      )}
      <div className="lab-card-area">
        <div
          className={`lab-card ${leaving ? 'leaving' : ''} ${dx !== 0 && !leaving ? 'dragging' : ''}`}
          style={{ transform: `translateX(${dx}px) rotate(${dx / 20}deg)` }}
          onPointerDown={(e) => {
            if (leaving) return;
            start.current = e.clientX;
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => start.current != null && setDx(e.clientX - start.current)}
          onPointerUp={up}
          onPointerCancel={() => {
            start.current = null;
            setDx(0);
          }}
          role="group"
          aria-label={`${card.name}. Swipe right if interested, left if not.`}
        >
          <div className="lab-card-word fr-card-name">{card.name}</div>
          <div className="lab-card-photo lab-photo-history">
            <img src={card.images[0]} alt="" draggable={false} />
          </div>
        </div>
      </div>
      <div className="fr-two">
        <button type="button" className="btn btn-ghost fr-tap" disabled={leaving} onClick={() => decide('not_for_me')}>
          {'\u{2715}'} {COPY.swipe.no}
        </button>
        <button type="button" className="btn btn-ghost fr-tap" disabled={leaving} onClick={() => decide('not_sure')}>
          {'\u{2212}'} {COPY.swipe.unsure}
        </button>
        <button type="button" className="btn btn-primary fr-tap" disabled={leaving} onClick={() => decide('interested')}>
          {'\u{2665}'} {COPY.swipe.yes}
        </button>
      </div>
      <p className="fr-sub" style={{ textAlign: 'center' }}>
        {index + 1} of {SWIPES}
      </p>
    </div>
  );
}

function RatingLabels({ place, onRate, onNotBeen }) {
  return (
    <div>
      <h2 className="fr-title">{COPY.rate.title}</h2>
      <p className="fr-sub">{COPY.rate.sub}</p>
      <div className="lab-card fr-rate-card">
        <div className="lab-card-word fr-card-name">{place.name}</div>
      </div>
      <div className="fr-stack">
        {TIERS.map((t) => (
          <button key={t.id} type="button" className="btn btn-ghost btn-block fr-tap" onClick={() => onRate(t.id)}>
            {t.emoji} {COPY.rate.labels[t.id]}
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-block fr-tap fr-not-been" onClick={onNotBeen}>
          {COPY.rate.notBeen}
        </button>
      </div>
    </div>
  );
}

// With the test switch on and no location, you're at `fallback` (card one).
function DistancePill({ coords, pretend, fallback, onCheckIn }) {
  const { units } = useUnits();
  const near = nearestPlace(coords) || (pretend && fallback ? { place: fallback, meters: 0 } : null);
  if (!near) return <p className="fr-sub">{COPY.checkin.noLocation}</p>;
  const meters = pretend ? 0 : near.meters;
  const inside = meters <= radiusOf(near.place);
  return (
    <div className="fr-checkin">
      <strong className="fr-place">{near.place.name}</strong>
      <p className={`fr-pill ${inside ? 'here' : ''}`} role="status">
        {inside ? COPY.checkin.here : COPY.checkin.away(formatDistance(meters, units), formatDistance(radiusOf(near.place), units))}
      </p>
      <button type="button" className="btn btn-primary btn-block fr-tap" disabled={!inside} onClick={() => onCheckIn(near.place, meters)}>
        {COPY.checkin.button}
      </button>
    </div>
  );
}

function ProgressRing({ count, goal, checkedIn }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const f = Math.min(1, count / goal);
  return (
    <div className="fr-progress">
      <div className="fr-ring-wrap">
        <svg viewBox="0 0 120 120" className="fr-ring" role="img" aria-label={COPY.progress.of(count, goal)}>
          <circle cx="60" cy="60" r={r} className="fr-ring-track" />
          <circle cx="60" cy="60" r={r} className="fr-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - f)} />
        </svg>
        <span className="fr-ring-count">
          {count}/{goal}
        </span>
        {checkedIn && <ConfettiBurst />}
      </div>
      {checkedIn && <p className="fr-badge">{'\u{1F3C5}'} {COPY.progress.badge}</p>}
      <h2 className="fr-title">{COPY.progress.title(goal)}</h2>
      <p className="fr-sub">{COPY.progress.of(count, goal)}</p>
    </div>
  );
}

function SignupPrompt({ trigger, onPick, onNotNow }) {
  return (
    <div className="fr-sheet fr-signup" role="dialog" aria-label={COPY.signup.title[trigger]}>
      <h2 className="fr-title">{COPY.signup.title[trigger]}</h2>
      <div className="fr-stack">
        {['email', 'google', 'apple'].map((how) => (
          <button key={how} type="button" className="btn btn-ghost btn-block fr-tap" onClick={() => onPick(how)}>
            {COPY.signup[how]}
          </button>
        ))}
      </div>
      <button type="button" className="fr-link fr-tap" onClick={onNotNow}>
        {COPY.signup.notNow}
      </button>
    </div>
  );
}

export default function FirstRunLab() {
  const { user } = useAuth();
  const { coords } = useGeo();
  const { myReviews } = useRatings();
  const { trip } = useTrip();
  const uid = user?.uid;
  const [state, dispatch] = useReducer(firstRunReducer, uid, (id) => loadFirstRun(id));
  const [log, setLog] = useState([]);
  const [pretend, setPretend] = useState(false);
  const [signup, setSignup] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const setFormPart = (patch) => setForm((f) => ({ ...f, ...patch }));
  // The cards stay put once dealt; the first GPS fix re-deals them to the
  // nearest places only if no card has been swiped yet.
  const [cards, setCards] = useState(() => pickCards(coords));
  const dealtNear = useRef(!!coords);
  const shownRef = useRef(false);
  const doneRef = useRef(false);

  useEffect(() => saveFirstRun(uid, state), [uid, state]);
  useEffect(() => {
    if (!coords || dealtNear.current || state.swipesDone > 0) return;
    dealtNear.current = true;
    setCards(pickCards(coords));
  }, [coords, state.swipesDone]);

  const track = (name, fields = {}) => setLog((l) => [...l, { name, fields, at: new Date().toLocaleTimeString() }]);
  const secs = () => secsSince(state.startedAt);

  // first_run_shown once per run, when the welcome sheet opens.
  useEffect(() => {
    if (state.step === 'welcome' && !shownRef.current) {
      shownRef.current = true;
      track('first_run_shown', { account_type: uid ? 'account' : 'guest' });
    }
    if ((state.step === 'progress' || state.step === 'skipped') && !doneRef.current) {
      doneRef.current = true;
      track('first_run_done', { outcome: state.step === 'skipped' ? 'skipped' : 'reached_progress' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step]);

  const stepDone = (extra = {}) => {
    track('first_run_step', { step: state.step, action: 'done', secs_since_start: secs() });
    dispatch({ type: 'NEXT', ...extra });
  };
  const skipStep = () => {
    track('first_run_step', { step: state.step, action: 'skip', secs_since_start: secs() });
    dispatch({ type: 'SKIP_STEP' });
  };
  const skipAll = () => {
    track('first_run_step', { step: state.step, action: 'skip', secs_since_start: secs() });
    dispatch({ type: 'SKIP_ALL' });
  };
  const restart = () => {
    shownRef.current = false;
    doneRef.current = false;
    setLog([]);
    setSignup(null);
    setForm(emptyForm());
    dispatch({ type: 'RESET' });
  };
  // The test controls' step buttons, Back and Next step.
  const at = ORDER.indexOf(state.step === 'rate' ? 'swipe' : state.step === 'skipped' ? 'done' : state.step);
  const jump = (i) => dispatch({ type: 'JUMP', step: ORDER[Math.max(0, Math.min(ORDER.length - 1, i))] });

  const accountRatings = Object.keys(myReviews || {}).length;
  const card = cards[state.swipesDone];
  const step = state.step;

  return (
    <div>
      <div className="card section lab-controls">
        <div className="lab-controls-head">
          <strong>{'\u{1F9EA}'} Tutorial 2 test</strong>
          <span className="tag">Nothing here is saved</span>
        </div>
        <div className="lab-steps">
          {ORDER.map((id, i) => (
            <button
              key={id}
              type="button"
              className={`lab-step ${i === at ? 'active' : ''} ${i < at ? 'done' : ''}`}
              onClick={() => jump(i)}
            >
              {i + 1}. {STEP_LABELS[id]}
            </button>
          ))}
        </div>
        <div className="lab-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={restart}>
            {'\u{21BA}'} Restart
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={at <= 0} onClick={() => jump(at - 1)}>
            {'\u{2190}'} Back
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={at >= ORDER.length - 1} onClick={() => jump(at + 1)}>
            Next step {'\u{2192}'}
          </button>
        </div>
        <div className="lab-actions" style={{ marginTop: 8 }}>
          <label className="fr-toggle">
            <input type="checkbox" checked={pretend} onChange={(e) => setPretend(e.target.checked)} /> Pretend I'm at the place
          </label>
        </div>
      </div>

      {!NO_SKIP.has(step) && !['welcome', 'done', 'skipped'].includes(step) && <SkipBar onSkip={skipStep} onSkipAll={skipAll} />}

      {step === 'signup' && <LabSignUp data={form} set={setFormPart} onDone={() => stepDone()} />}
      {step === 'verify' && <TutorialVerify email={form.email} onDone={() => stepDone()} />}
      {step === 'welcome' && <WelcomeSheet onShow={() => stepDone()} onSkip={skipAll} />}
      {step === 'taste' && <TasteChips saved={trip.savedInterests || []} onNext={(chips) => stepDone({ chips })} />}
      {step === 'swipe' && card && (
        <SwipeDeck
          key={card.id}
          card={card}
          index={state.swipesDone}
          onSwipe={(dir) => {
            track('first_swipe', { direction: dir, card_id: card.id, index: state.swipesDone });
            if (state.swipesDone + 1 >= SWIPES) track('first_run_step', { step: 'swipe', action: 'done', secs_since_start: secs() });
            dispatch({ type: 'SWIPE', dir, place: { id: card.id, name: card.name } });
          }}
        />
      )}
      {step === 'rate' && state.ratePlace && (
        <RatingLabels
          place={state.ratePlace}
          onRate={(tier) => {
            track('first_rating', { label: tier, place_id: state.ratePlace.id });
            track('first_run_step', { step: 'rate', action: 'done', secs_since_start: secs() });
            dispatch({ type: 'RATE', label: tier });
          }}
          onNotBeen={() => {
            track('first_run_step', { step: 'rate', action: 'not_been', secs_since_start: secs() });
            dispatch({ type: 'NOT_BEEN' });
          }}
        />
      )}
      {step === 'checkin' && (
        <div>
          <h2 className="fr-title">{COPY.checkin.title}</h2>
          <DistancePill
            coords={coords}
            pretend={pretend}
            fallback={cards[0]}
            onCheckIn={(place, meters) => {
              track('first_checkin', { distance_ft: Math.round(meters * 3.28084), secs_since_start: secs() });
              track('first_run_step', { step: 'checkin', action: 'done', secs_since_start: secs() });
              dispatch({ type: 'CHECKIN_OK' });
            }}
          />
        </div>
      )}
      {step === 'progress' && (
        <div>
          <ProgressRing count={Math.min(PROGRESS_GOAL, accountRatings + state.ratingsCount)} goal={PROGRESS_GOAL} checkedIn={state.checkinsCount > 0} />
          <button type="button" className="btn btn-primary btn-block fr-tap" onClick={() => stepDone()}>
            {COPY.progress.button}
          </button>
        </div>
      )}
      {step === 'location' && <TutorialLocation onDone={() => stepDone()} />}
      {step === 'tabs' && <TutorialTabs onDone={() => stepDone()} />}
      {(step === 'done' || step === 'skipped') && (
        <div className="lab-center">
          <h2 className="fr-title">{COPY[step].title}</h2>
          <p className="fr-sub">{COPY[step].sub}</p>
          <p className="fr-sub">Try the sign-up prompt from a trigger:</p>
          <div className="fr-stack">
            {SIGNUP_TRIGGERS.map((t) => (
              <button
                key={t}
                type="button"
                className="btn btn-ghost btn-block fr-tap"
                onClick={() => {
                  track('signup_prompt', { trigger: t });
                  setSignup(t);
                }}
              >
                {COPY.signup.title[t]}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-primary btn-block fr-tap" style={{ marginTop: 12 }} onClick={restart}>
            {'\u{21BA}'} Restart
          </button>
        </div>
      )}
      {signup && (
        <SignupPrompt
          trigger={signup}
          onPick={() => setSignup(null)}
          onNotNow={() => {
            dispatch({ type: 'SIGNUP_NOT_NOW' });
            setSignup(null);
          }}
        />
      )}

      <div className="card section">
        <strong>Analytics events</strong>
        <p className="screen-subtitle" style={{ margin: '4px 0 8px' }}>
          What would fire. Nothing is sent: the app has no analytics yet.
        </p>
        {log.length ? (
          <ol className="lab-log fr-events">
            {log.map((e, i) => (
              <li key={i}>
                <code>{e.name}</code> {Object.entries(e.fields).map(([k, v]) => `${k}=${v}`).join(', ')}
              </li>
            ))}
          </ol>
        ) : (
          <p className="screen-subtitle">None yet.</p>
        )}
      </div>
    </div>
  );
}

