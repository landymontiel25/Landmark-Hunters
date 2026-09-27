import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useGeo } from '../lib/GeoContext';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { isAdmin } from '../lib/admins';
import { ALL_LANDMARKS, INTERESTS } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import LandmarkThumb from '../components/LandmarkThumb';

// Admin-only sandbox of the real sign-up + onboarding flow (SignInForm ->
// OnboardingPreferences -> TasteIntroStep -> FirstCheckInStep in
// Profile.jsx), for trying out how onboarding should feel. Everything here
// is local state: no account is created, nothing is written to Firestore or
// the saved trip, and "Restart" wipes it. Copy and layout mirror the real
// screens so what you try here is what a new user would see.
const STEPS = [
  { id: 'signup', label: 'Sign up' },
  { id: 'preferences', label: 'Interests' },
  { id: 'taste', label: 'Taste' },
  { id: 'checkin', label: 'First check-in' },
  { id: 'done', label: 'Done' },
];

const EMPTY = { name: '', email: '', password: '', age: false, interests: [], taste: '', checkedIn: false, via: null };

export default function OnboardingLab() {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [data, setData] = useState(EMPTY);
  const [log, setLog] = useState([]);
  const set = (patch) => setData((d) => ({ ...d, ...patch }));
  const note = (text) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} — ${text}`]);

  if (!isAdmin(user?.email)) return <Navigate to="/" replace />;

  const go = (i, why) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, i));
    note(`${why}: ${STEPS[step].label} → ${STEPS[next].label}`);
    setStep(next);
  };
  const restart = () => {
    setData(EMPTY);
    setLog([]);
    setStep(0);
  };

  const id = STEPS[step].id;

  return (
    <div>
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
            {'\u{21BA}'} Restart sign-up
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={step === 0} onClick={() => go(step - 1, 'Back')}>
            {'\u{2190}'} Back
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={step === STEPS.length - 1}
            onClick={() => go(step + 1, 'Continue sign-up')}
          >
            Continue sign-up {'\u{2192}'}
          </button>
        </div>
      </div>

      {id === 'signup' && <LabSignUp data={data} set={set} onDone={(via) => { set({ via }); go(1, `Signed up (${via})`); }} />}
      {id === 'preferences' && <LabPreferences data={data} set={set} onDone={(how) => go(2, how)} />}
      {id === 'taste' && <LabTaste data={data} set={set} onDone={(how) => go(3, how)} />}
      {id === 'checkin' && <LabCheckIn data={data} set={set} onDone={(how) => go(4, how)} />}
      {id === 'done' && <LabSummary data={data} log={log} onRestart={restart} />}
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
        <label className="lab-age">
          <input type="checkbox" checked={data.age} onChange={(e) => set({ age: e.target.checked })} />
          <span>I am 13 years of age or older.</span>
        </label>
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

function LabPreferences({ data, set, onDone }) {
  const toggle = (id) =>
    set({ interests: data.interests.includes(id) ? data.interests.filter((x) => x !== id) : [...data.interests, id] });
  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F389}'}</span> Welcome!
      </h1>
      <p className="screen-subtitle">
        What are you usually into? Save it now and Setup can fill it in for you on every trip from here on.
      </p>
      <div className="chip-grid">
        {INTERESTS.map((i) => (
          <button key={i.id} type="button" className={`chip ${data.interests.includes(i.id) ? 'selected' : ''}`} onClick={() => toggle(i.id)}>
            <span className="chip-icon">{i.icon}</span>
            <span>{i.label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 20 }}
        onClick={() => onDone(`Continued with ${data.interests.length} interest(s)`)}
      >
        Continue {'\u{2192}'}
      </button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => onDone('Skipped interests')}>
        Skip for now
      </button>
    </div>
  );
}

function LabTaste({ data, set, onDone }) {
  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F9E9}'}</span> Tell Mapr what you love
      </h1>
      <p className="screen-subtitle">
        Optional, but it helps -- give Mapr a quick overview of your taste and it can start suggesting well before your
        first rating.
      </p>
      <textarea
        className="rating-comment"
        aria-label="What you love"
        rows={5}
        maxLength={2000}
        placeholder="What are you already into?"
        value={data.taste}
        onChange={(e) => set({ taste: e.target.value })}
      />
      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 20 }}
        disabled={!data.taste.trim()}
        onClick={() => onDone('Saved taste intro')}
      >
        Continue {'\u{2192}'}
      </button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => onDone('Skipped taste intro')}>
        Skip for now
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
  const labels = data.interests.map((id) => INTERESTS.find((i) => i.id === id)?.label || id);
  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F3C1}'}</span> Onboarding finished
      </h1>
      <p className="screen-subtitle">A real account would land on Profile here with the Welcome badge and 10 bonus points.</p>
      <div className="card section">
        <p>
          <strong>Signed up with:</strong> {data.via || '—'}
        </p>
        <p>
          <strong>Interests:</strong> {labels.length ? labels.join(', ') : 'none (skipped)'}
        </p>
        <p>
          <strong>Taste intro:</strong> {data.taste.trim() || 'none (skipped)'}
        </p>
        <p>
          <strong>First check-in:</strong> {data.checkedIn ? 'yes' : 'skipped'}
        </p>
      </div>
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
        {'\u{21BA}'} Restart sign-up
      </button>
    </div>
  );
}
