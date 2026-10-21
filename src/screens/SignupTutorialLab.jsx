import { Suspense, useState } from 'react';
import { Route, Routes, UNSAFE_RouteContext as RouteContext } from 'react-router-dom';
import ErrorBoundary from '../components/ErrorBoundary';
import { MaprBubble, MaprSays } from '../components/MaprTutorial';
import { SAY, TABS } from './signupTutorialSteps';
import { TAB_SCREENS } from './tutorialTabScreens';

// The Tutorial's explain-only steps (Test tab, screens/OnboardingLab): a
// small drawn phone screen plus Mapr's bubbles, for steps the sandbox can't
// run for real (email verification, the iPhone location prompt, the tabs).
// Nothing is created or saved. The words live in signupTutorialSteps.js.

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
const ROOT_ROUTE = { outlet: null, matches: [], isDataRoute: false };
function TabScreen({ stop }) {
  const Screen = TAB_SCREENS[stop.path];
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
    <div className="tut-screen" aria-hidden="true" inert>
      <div className="tut-screen-inner">
        <ErrorBoundary fallback={plain}>
          <Suspense fallback={plain}>
            <RouteContext.Provider value={ROOT_ROUTE}>
              <Routes location={{ pathname: stop.path, search: '', hash: '', state: null, key: 'tutorial' }}>
                <Route path={stop.path} element={<Screen />} />
              </Routes>
            </RouteContext.Provider>
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
        <TabScreen stop={stop} />
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
      <MaprBubble>{stop.say}</MaprBubble>
      <NextButton onClick={() => (last ? onDone() : setI(i + 1))}>{last ? 'Finish' : 'Next tab'}</NextButton>
    </div>
  );
}
