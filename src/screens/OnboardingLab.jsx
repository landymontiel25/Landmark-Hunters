import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useGeo } from '../lib/GeoContext';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { isAdmin } from '../lib/admins';
import { ALL_LANDMARKS, INTERESTS, getRegion } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import { allSwipeCards, tagDeltasFromAnswers, SWIPE_DELTAS } from '../lib/onboardingCards';
import { searchScore } from '../lib/search';
import LandmarkThumb from '../components/LandmarkThumb';
import { HowToStep as LabInstructions, SwipeCardStack as LabCardStack, progressTier } from '../components/OnboardingSteps';
import { NOTHING_TO_TEST } from './onboardingLabConfig';

export { progressTier };

// Admin-only sandbox for trying out sign-up + onboarding. Everything here is
// local state: no account is created, nothing is written to Firestore or the
// saved trip, and "Restart" wipes it. The results screen shows what a real
// signup would have saved (tagScores changes and notes) without saving it.
// Sign-up is step 1, then "Your places", then the rating cards.
const SIGNUP_ON = true;
const STEPS = [
  ...(SIGNUP_ON ? [{ id: 'signup', label: 'Sign up' }] : []),
  { id: 'places', label: 'Your places' },
  { id: 'prompt', label: 'Rate prompt' },
  { id: 'howto', label: 'Instructions' },
  { id: 'cards', label: 'Cards' },
  { id: 'notes', label: 'Anything else' },
  { id: 'checkin', label: 'First check-in' },
  { id: 'done', label: 'Done' },
];
// The Test tab's sub-tabs, shown as floating bubbles above the test. Add an
// entry here (and render it below) for each new test.
const TESTS = [{ id: 'onboarding', label: 'Onboarding' }];
const indexOf = (id) => STEPS.findIndex((s) => s.id === id);

const empty = () => ({
  name: '',
  email: '',
  password: '',
  age: false,
  via: null,
  skippedRating: false,
  places: [],
  // All 39 here so every card gets tested; real signups get 15-18 (pickSwipeCards).
  cards: allSwipeCards(),
  answers: [],
  notes: '',
  checkedIn: false,
});

export default function OnboardingLab() {
  const { user, loading: authLoading } = useAuth();
  const [step, setStep] = useState(0);
  const [data, setData] = useState(empty);
  const [log, setLog] = useState([]);
  const set = (patch) => setData((d) => ({ ...d, ...patch }));
  const note = (text) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} — ${text}`]);

  if (authLoading) return null;
  if (!isAdmin(user?.email)) return <Navigate to="/" replace />;

  if (NOTHING_TO_TEST) {
    return (
      <div className="lab-center">
        <h1 className="screen-title">
          <span>{'\u{1F9EA}'}</span> Nothing to test
        </h1>
        <p className="screen-subtitle">There's no new onboarding to try right now. This tab will come back when there is.</p>
      </div>
    );
  }

  const go = (target, why) => {
    const i = typeof target === 'string' ? indexOf(target) : target;
    const next = Math.max(0, Math.min(STEPS.length - 1, i));
    note(`${why}: ${STEPS[step].label} → ${STEPS[next].label}`);
    setStep(next);
  };
  const restart = () => {
    setData(empty());
    setLog([]);
    setStep(0);
  };

  const id = STEPS[step].id;

  return (
    <div>
      <div className="lab-tabs" role="tablist" aria-label="Tests">
        {TESTS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected className="lab-tab active">
            {t.label}
          </button>
        ))}
      </div>
      <div className="card section lab-controls">
        <div className="lab-controls-head">
          <strong>{'\u{1F9EA}'} Onboarding test</strong>
          <span className="tag">Nothing here is saved</span>
        </div>
        <div className="lab-steps">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`lab-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
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
          <button type="button" className="btn btn-ghost btn-sm" disabled={step === 0} onClick={() => go(step - 1, 'Back')}>
            {'\u{2190}'} Back
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={step === STEPS.length - 1}
            onClick={() => go(step + 1, 'Next step')}
          >
            Next step {'\u{2192}'}
          </button>
        </div>
      </div>

      {id === 'signup' && (
        <LabSignUp
          data={data}
          set={set}
          onDone={(via) => {
            set({ via });
            go('places', `Signed up (${via})`);
          }}
        />
      )}
      {id === 'places' && (
        <LabPlaces
          places={data.places}
          onChange={(places, what) => {
            note(what);
            set({ places });
          }}
          onDone={() => go('prompt', data.places.length ? `Added ${data.places.length} places` : 'Skipped places')}
        />
      )}
      {id === 'prompt' && (
        <LabRatePrompt
          onSkip={() => {
            set({ skippedRating: true });
            go('done', 'Skipped rating, straight into the app');
          }}
          onNext={() => {
            set({ skippedRating: false });
            go('howto', 'Chose to rate');
          }}
        />
      )}
      {id === 'howto' && <LabInstructions onNext={() => go('cards', 'Read instructions')} />}
      {id === 'cards' && (
        <LabCardStack
          cards={data.cards}
          answers={data.answers}
          onAnswer={(card, answer) => {
            note(`${card.word}: ${answer === 'love' ? 'love it' : answer === 'dislike' ? "don't like it" : 'not sure'}`);
            set({ answers: [...data.answers.filter((a) => a.card.word !== card.word), { card, answer }] });
          }}
          onUndo={() => {
            const last = data.answers[data.answers.length - 1];
            if (!last) return;
            note(`Undo: ${last.card.word}`);
            set({ answers: data.answers.slice(0, -1) });
          }}
          onFinished={() => go('notes', 'Finished cards')}
        />
      )}
      {id === 'notes' && (
        <LabNotes data={data} set={set} onDone={(how) => go('checkin', how)} />
      )}
      {id === 'checkin' && <LabCheckIn data={data} set={set} onDone={(how) => go('done', how)} />}
      {id === 'done' && <LabSummary data={data} log={log} onRestart={restart} />}
    </div>
  );
}

const MAX_PLACES = 10;

// Profile step: "Tell us the 10 places you visit most". Typing a name pops
// up matching places from the catalog; Tab or Enter takes the top match and
// tapping any row adds that one. Local state only, like the rest of the Lab.
function LabPlaces({ places, onChange, onDone }) {
  const [term, setTerm] = useState('');
  const q = term.trim();
  const full = places.length >= MAX_PLACES;
  const suggestions = useMemo(() => {
    if (!q) return [];
    const taken = new Set(places.map((l) => `${l.regionId}/${l.id}`));
    return ALL_LANDMARKS.filter((l) => !taken.has(`${l.regionId}/${l.id}`))
      .map((l) => ({ l, score: searchScore(l.name, getRegion(l.regionId)?.name || '', q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.l.name.localeCompare(b.l.name))
      .slice(0, 6)
      .map((x) => x.l);
  }, [q, places]);
  const top = suggestions[0];

  const add = (l) => {
    if (full) return;
    onChange([...places, l], `Added place: ${l.name}`);
    setTerm('');
  };
  const remove = (l) => onChange(places.filter((p) => p !== l), `Removed place: ${l.name}`);
  const onKeyDown = (e) => {
    if ((e.key === 'Tab' || e.key === 'Enter') && top && !full) {
      e.preventDefault();
      add(top);
    }
  };
  // Greyed-out rest of the top match's name, so Tab visibly completes it.
  const ghost = top && top.name.toLowerCase().startsWith(term.toLowerCase()) ? top.name.slice(term.length) : '';

  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F4CD}'}</span> Your places
      </h1>
      <p className="screen-subtitle">Tell us the 10 places you visit most, and we'll help you discover new spots you'll love.</p>
      <div className="field lab-place-search">
        <label htmlFor="lab-place">
          Place {places.length} of {MAX_PLACES}
        </label>
        <div className="lab-place-input">
          {ghost && (
            <span className="lab-place-ghost" aria-hidden="true">
              <span style={{ visibility: 'hidden' }}>{term}</span>
              {ghost}
            </span>
          )}
          <input
            id="lab-place"
            type="search"
            autoComplete="off"
            placeholder={full ? 'That is 10, nice' : 'Start typing a place name'}
            disabled={full}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        {suggestions.length > 0 && (
          <ul className="lab-log lab-place-suggestions" role="listbox">
            {suggestions.map((l) => (
              <li key={`${l.regionId}/${l.id}`}>
                <button type="button" role="option" aria-selected={l === top} className="btn btn-ghost btn-block" onClick={() => add(l)}>
                  {l.name} <span className="screen-subtitle">{getRegion(l.regionId)?.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q && suggestions.length === 0 && !full && <p className="screen-subtitle">No place matches “{q}”.</p>}
      </div>
      {places.length > 0 && (
        <ol className="lab-log lab-place-list">
          {places.map((l) => (
            <li key={`${l.regionId}/${l.id}`}>
              {l.name}{' '}
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${l.name}`} onClick={() => remove(l)}>
                {'\u{2715}'}
              </button>
            </li>
          ))}
        </ol>
      )}
      <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 20 }} onClick={onDone}>
        {places.length ? 'Continue' : 'Skip for now'} {'\u{2192}'}
      </button>
    </div>
  );
}

function LabRatePrompt({ onSkip, onNext }) {
  return (
    <div className="lab-center">
      <h1 className="screen-title">
        <span>{'\u{1F389}'}</span> You're in!
      </h1>
      <p className="screen-subtitle">Rate a few things you're into — takes 60-90 seconds.</p>
      <button type="button" className="btn btn-primary btn-block" onClick={onNext}>
        Next {'\u{2192}'}
      </button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onSkip}>
        Skip
      </button>
    </div>
  );
}

function LabNotes({ data, set, onDone }) {
  return (
    <div>
      <h1 className="screen-title">Anything else?</h1>
      <p className="screen-subtitle">Anything else you love or hate that we didn't cover?</p>
      <textarea
        className="rating-comment"
        aria-label="Anything else you love or hate"
        rows={5}
        maxLength={2000}
        placeholder="Optional"
        value={data.notes}
        onChange={(e) => set({ notes: e.target.value })}
      />
      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 20 }}
        onClick={() => onDone(data.notes.trim() ? 'Added notes' : 'Continued without notes')}
      >
        {data.notes.trim() ? 'Save & continue' : 'Continue'} {'\u{2192}'}
      </button>
    </div>
  );
}

function LabSignUp({ data, set, onDone }) {
  const [error, setError] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (!data.age) {
      setError('You must confirm you’re 13 or older to create an account.');
      return;
    }
    setError('');
    onDone('email');
  };
  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F6C2}'}</span> Sign In
      </h1>
      <p className="screen-subtitle">Sign in to check in, rate places, add friends, and hit the leaderboard.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="lab-name">Display Name</label>
          <input id="lab-name" type="text" value={data.name} onChange={(e) => set({ name: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="lab-email">Email</label>
          <input id="lab-email" type="email" value={data.email} onChange={(e) => set({ email: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="lab-password">Password</label>
          <input
            id="lab-password"
            type="password"
            autoComplete="off"
            value={data.password}
            onChange={(e) => set({ password: e.target.value })}
            required
            minLength={6}
          />
        </div>
        {error && (
          <p className="tag tag-error" role="alert" style={{ display: 'block', marginBottom: 14 }}>
            {error}
          </p>
        )}
        <label className="lab-age check-age-label">
          <input type="checkbox" checked={data.age} onChange={(e) => set({ age: e.target.checked })} />
          <span>I am 13 years of age or older.</span>
        </label>
        <p style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--color-parchment-dim)', margin: '0 0 10px' }}>
          By creating an account, you agree to our{' '}
          <Link to="/legal" style={{ color: 'var(--color-parchment-dim)' }}>
            Terms of Service &amp; Privacy Policy
          </Link>
          .
        </p>
        <button className="btn btn-primary btn-block" type="submit">
          Create Account
        </button>
      </form>
      <div className="lab-divider">
        <span>or</span>
      </div>
      <button type="button" className="btn btn-ghost btn-block" onClick={() => onDone('Google')}>
        {'\u{1F510}'} Sign up with Google
      </button>
    </div>
  );
}

function LabCheckIn({ data, set, onDone }) {
  const { coords, loading } = useGeo();
  const { units } = useUnits();
  let nearest = null;
  if (coords) {
    for (const l of ALL_LANDMARKS) {
      const d = distanceMeters(coords.lat, coords.lng, l.lat, l.lng);
      if (!nearest || d < nearest.meters) nearest = { landmark: l, meters: d };
    }
  }
  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F4CD}'}</span> Your First Check-In
      </h1>
      <p className="screen-subtitle">One tap to earn your first point.</p>
      {!coords && <p className="screen-subtitle">{loading ? 'Finding your location…' : "Can't find your location right now."}</p>}
      {nearest && (
        <div className="card section" style={{ textAlign: 'center' }}>
          <LandmarkThumb landmark={nearest.landmark} size={96} />
          <h3 style={{ marginBottom: 4 }}>{nearest.landmark.name}</h3>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            {formatDistance(nearest.meters, units)} away
          </p>
          <button type="button" className="btn btn-primary btn-block" disabled={data.checkedIn} onClick={() => set({ checkedIn: true })}>
            {data.checkedIn ? '\u{2705} Checked in (pretend)' : 'Check In'}
          </button>
        </div>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-block"
        style={{ marginTop: 10 }}
        onClick={() => onDone(data.checkedIn ? 'Checked in, continued' : 'Skipped first check-in')}
      >
        {data.checkedIn ? 'Continue' : 'Skip for now'}
      </button>
    </div>
  );
}

function LabSummary({ data, log, onRestart }) {
  const tagLabel = (id) => INTERESTS.find((i) => i.id === id)?.label || id;
  const deltas = tagDeltasFromAnswers(data.answers);
  const count = (a) => data.answers.filter((x) => x.answer === a).length;
  const answerLabel = { love: 'love it', dislike: "don't like it", unsure: 'not sure' };
  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F3C1}'}</span> Onboarding finished
      </h1>
      <p className="screen-subtitle">What a real signup would have saved. Nothing here was actually saved.</p>
      <div className="card section">
        {SIGNUP_ON && (
          <p>
            <strong>Signed up with:</strong> {data.via || '—'}
          </p>
        )}
        {data.skippedRating ? (
          <p>
            <strong>Rating:</strong> skipped — straight into the app, no preference data yet
          </p>
        ) : (
          <p>
            <strong>Cards:</strong> {data.answers.length} of {data.cards.length} rated — {count('love')} love it,{' '}
            {count('dislike')} don't like it, {count('unsure')} not sure
          </p>
        )}
        <p>
          <strong>Places you visit most:</strong> {data.places.length ? data.places.map((l) => l.name).join(', ') : 'none'}
        </p>
        <p>
          <strong>First check-in:</strong> {data.checkedIn ? 'yes' : 'skipped'}
        </p>
      </div>

      {!data.skippedRating && (
        <>
          <div className="card section">
            <strong>tagScores changes</strong>
            <p className="screen-subtitle" style={{ margin: '4px 0 8px' }}>
              Love it {SWIPE_DELTAS.love > 0 ? '+' : ''}
              {SWIPE_DELTAS.love}, don't like it {SWIPE_DELTAS.dislike}, not sure 0 — summed per tag.
            </p>
            {Object.keys(deltas).length ? (
              <ul className="lab-log">
                {Object.entries(deltas)
                  .sort((a, b) => b[1] - a[1])
                  .map(([tag, d]) => (
                    <li key={tag}>
                      {tagLabel(tag)} <code>{tag}</code>: {d > 0 ? '+' : ''}
                      {d}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="screen-subtitle">No changes (nothing loved or disliked).</p>
            )}
          </div>

          <div className="card section">
            <strong>Each card</strong>
            <ul className="lab-log">
              {data.answers.map(({ card, answer }) => (
                <li key={card.word}>
                  {card.icon} {card.word} → {answerLabel[answer]} <code>{card.tag}</code>{' '}
                  {card.photoPages.map((href, i) => (
                    <a key={href} href={href} target="_blank" rel="noreferrer" style={{ marginRight: 6 }}>
                      photo{card.photoPages.length > 1 ? ` ${i + 1}` : ''}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
          </div>

          <div className="card section">
            <strong>Onboarding notes</strong>
            <p className="screen-subtitle" style={{ margin: '4px 0 0' }}>
              {data.notes.trim() ? `"${data.notes.trim()}"` : 'none'}
            </p>
            <p className="screen-subtitle" style={{ fontSize: '0.75rem' }}>
              Kept as raw text and passed to Mapr as context, never turned into new tags.
            </p>
          </div>
        </>
      )}

      {log.length > 0 && (
        <div className="card section">
          <strong>What happened</strong>
          <ol className="lab-log">
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </div>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={onRestart}>
        {'\u{21BA}'} Restart
      </button>
    </div>
  );
}
