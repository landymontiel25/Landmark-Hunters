import { Suspense, useContext, useMemo, useState } from 'react';
import { Link, Route, Routes, UNSAFE_NavigationContext as NavigationContext, UNSAFE_RouteContext as RouteContext } from 'react-router-dom';
import ErrorBoundary from '../components/ErrorBoundary';
import { MaprBubble, MaprSays } from '../components/MaprTutorial';
import { SAY, TABS } from './signupTutorialSteps';
import { TAB_SCREENS } from './tutorialTabScreens';

// The Tutorial's explain-only steps (Test tab, screens/OnboardingLab): a
// small drawn phone screen plus Mapr's bubbles, for steps the sandbox can't
// run for real (email verification, the iPhone location prompt, the tabs).
// Nothing is created or saved. The words live in signupTutorialSteps.js.
// The sign-up form and "Anything else" box are shared by Tutorial and
// Tutorial 2 (FirstRunLab).

function Phone({ children }) {
  return <div className="tut-phone">{children}</div>;
}

function NextButton({ onClick, children = 'Next' }) {
  return (
    <button type="button" className="btn btn-primary btn-block" onClick={onClick}>
      {children} {'\u{2192}'}
    </button>
  );
}

export function TutorialHello({ onDone }) {
  return (
    <div className="tut nav-clear">
      <Phone>
        <div className="tut-hero" aria-hidden="true">
          {'\u{1F9ED}'}
        </div>
      </Phone>
      <MaprSays lines={SAY.hello} />
      <NextButton onClick={onDone}>Let's go</NextButton>
    </div>
  );
}

export function TutorialVerify({ email, onDone }) {
  return (
    <div className="tut nav-clear">
      <Phone>
        <div className="tut-hero" aria-hidden="true">
          {'\u{1F4E7}'}
        </div>
        <div className="tut-screen-title">Verify your email</div>
        <p className="tut-small">We sent a link to {email || 'your email'}</p>
        <div className="tut-btn">Resend email</div>
      </Phone>
      <MaprSays lines={SAY.verify} />
      <NextButton onClick={onDone}>I tapped the link (pretend)</NextButton>
    </div>
  );
}

export function TutorialLocation({ onDone }) {
  return (
    <div className="tut nav-clear">
      <Phone>
        <div className="tut-dialog">
          <strong>Allow "Landmark Hunters" to use your location?</strong>
          <div className="tut-dialog-btn">Keep Only While Using</div>
          <div className="tut-dialog-btn tut-pulse">Change to Always Allow</div>
        </div>
      </Phone>
      <MaprSays lines={SAY.location} />
      <NextButton onClick={onDone} />
    </div>
  );
}

// The tab's real screen, live but shrunk and not clickable (inert). Rendered
// at its own path (a Routes with a fixed location, under a reset route context
// so the Test tab's own /test route doesn't get in the way) so it reads its
// route as usual. The scaled box's transform also holds the screen's fixed-position
// pieces (sheets, floating buttons) inside the frame. If the screen can't
// load or crashes, the tab's icon and name show instead.
//
// `live` (the Map stop: owner, 2026-10-21) lets you use it, e.g. tap a pin.
// Nothing in it can take you out of the tutorial: its navigation goes to a
// navigator that goes nowhere, and taps on plain "#/..." links are dropped.
const ROOT_ROUTE = { outlet: null, matches: [], isDataRoute: false };
const stayPut = (e) => {
  if (e.target.closest?.('a[href^="#"], a[href^="/"]')) e.preventDefault();
};
export function TabScreen({ stop, live = false }) {
  const Screen = TAB_SCREENS[stop.path];
  const nav = useContext(NavigationContext);
  const stuck = useMemo(
    () => ({ ...nav, navigator: { ...nav.navigator, push() {}, replace() {}, go() {} } }),
    [nav]
  );
  const plain = (
    <div className="tut-screen-plain">
      <div className="tut-hero" aria-hidden="true">
        {stop.icon}
      </div>
      <div className="tut-screen-title">{stop.tab}</div>
    </div>
  );
  if (!Screen) return plain;
  return (
    <div
      className={`tut-screen${live ? ' live' : ''}`}
      aria-hidden={live ? undefined : 'true'}
      inert={!live}
      onClickCapture={stayPut}
    >
      <div className="tut-screen-inner">
        <ErrorBoundary fallback={plain}>
          <Suspense fallback={plain}>
            <NavigationContext.Provider value={stuck}>
              <RouteContext.Provider value={ROOT_ROUTE}>
                <Routes location={{ pathname: stop.path, search: '', hash: '', state: null, key: 'tutorial' }}>
                  <Route path={stop.path} element={<Screen />} />
                </Routes>
              </RouteContext.Provider>
            </NavigationContext.Provider>
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}

// One stop per tab; tap a tab in the drawn bar to jump to it.
export function TutorialTabs({ onDone }) {
  const [i, setI] = useState(0);
  const stop = TABS[i];
  const last = i === TABS.length - 1;
  return (
    <div className="tut nav-clear">
      <p className="tut-count">
        Tab {i + 1} of {TABS.length}: <strong>{stop.tab}</strong>
      </p>
      <Phone key={stop.tab}>
        <TabScreen stop={stop} live={!!stop.live} />
        <div className="tut-nav">
          {TABS.map((t, n) => (
            <button
              key={t.tab}
              type="button"
              className={`tut-nav-item ${n === i ? 'active' : ''}`}
              aria-pressed={n === i}
              onClick={() => setI(n)}
            >
              <span aria-hidden="true">{t.icon}</span>
              <span>{t.tab}</span>
            </button>
          ))}
        </div>
      </Phone>
      {stop.live && stop.tryIt && <p className="tut-try">{stop.tryIt}</p>}
      <MaprBubble>{stop.say}</MaprBubble>
      <NextButton onClick={() => (last ? onDone() : setI(i + 1))}>{last ? 'Finish' : 'Next tab'}</NextButton>
    </div>
  );
}

export function LabNotes({ data, set, onDone }) {
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

export function LabSignUp({ data, set, onDone }) {
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
