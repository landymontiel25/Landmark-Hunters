import { useState } from 'react';
import { MaprSays } from '../components/MaprTutorial';
import { TabScreen } from './SignupTutorialLab';
import { INTRO, STEPS } from './itineraryTutorialSteps';

// Test tab "Itinerary tutorial": what someone sees the first time they open
// the Itinerary tab. Over the real Itinerary screen, a sheet asks whether
// they want to learn how to make an itinerary: Skip closes it, Show me walks
// through what the tab does, one step at a time, with Mapr explaining and a
// small drawn screen per step. Skip tutorial on every step. Nothing is saved.
// The words are in itineraryTutorialSteps.js.

const ITINERARY_STOP = { path: '/itinerary', tab: 'Itinerary', icon: '\u{1F5FA}\u{FE0F}' };

const MOCKS = {
  start: () => (
    <>
      <div className="tut-screen-title">Itinerary</div>
      <div className="tut-btn tut-btn-primary tut-pulse">{'\u{1F9ED}'} Use Mapr (recommended)</div>
      <div className="tut-btn">{'\u{2795}'} Create New Trip</div>
    </>
  ),
  add: () => (
    <div className="tut-place">
      <div className="tut-photo" aria-hidden="true">
        {'\u{1F3DB}\u{FE0F}'}
      </div>
      <div className="itut-row">
        <strong>Sample Museum</strong>
        <span className="itut-pulse-icon" aria-hidden="true">
          {'\u{1F516}'}
        </span>
      </div>
      <div className="tut-btn">+ Miami itinerary</div>
    </div>
  ),
  order: () => (
    <>
      <div className="itut-row">
        <strong>My Miami trip</strong>
        <span className="tut-btn itut-chip tut-pulse">{'\u{270F}\u{FE0F}'} Edit List</span>
      </div>
      {['Sample Museum', 'Beach Park', 'Coffee Spot'].map((name) => (
        <div key={name} className="itut-stop">
          <span className="itut-minus" aria-hidden="true">
            {'\u{2212}'}
          </span>
          <span className="itut-stop-name">{name}</span>
          <span aria-hidden="true">{'\u{2630}'}</span>
        </div>
      ))}
    </>
  ),
  go: () => (
    <>
      <div className="itut-route" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`itut-pin itut-pin-${n}`}>
            {n}
          </span>
        ))}
      </div>
      <div className="itut-row">
        <span className="tut-btn tut-btn-primary itut-chip tut-pulse">{'\u{25B6}\u{FE0F}'} Start Trip</span>
        <span className="tut-btn itut-chip">{'\u{1F4E4}'} Share</span>
      </div>
    </>
  ),
  friends: () => (
    <>
      <div className="tut-screen-title">Members</div>
      <div className="itut-stop">
        <span aria-hidden="true">{'\u{1F642}'}</span>
        <span className="itut-stop-name">You</span>
      </div>
      <div className="tut-btn tut-pulse">{'\u{2795}'} Add a user</div>
      <div className="tut-btn">{'\u{1F4CD}'} Share live location</div>
    </>
  ),
  past: () => (
    <>
      <div className="itut-row itut-tabs">
        <span className="tut-btn itut-chip">Current</span>
        <span className="tut-btn tut-btn-primary itut-chip">Past</span>
      </div>
      <div className="itut-stop">
        <span aria-hidden="true">{'\u{2705}'}</span>
        <span className="itut-stop-name">My Miami trip</span>
      </div>
    </>
  ),
};

export default function ItineraryTutorialLab() {
  // 'intro' (the first-visit sheet), a step index, 'done' or 'skipped'.
  const [at, setAt] = useState('intro');
  const restart = () => setAt('intro');

  return (
    <div>
      <div className="card section lab-controls">
        <div className="lab-controls-head">
          <strong>{'\u{1F9EA}'} Itinerary tutorial test</strong>
          <span className="tag">Nothing here is saved</span>
        </div>
        <p className="screen-subtitle" style={{ margin: '6px 0 8px' }}>
          What someone sees the first time they open the Itinerary tab.
        </p>
        <div className="lab-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={restart}>
            {'\u{21BA}'} Restart
          </button>
        </div>
      </div>

      {at === 'intro' && (
        <div className="tut-phone fr-map">
          <TabScreen stop={ITINERARY_STOP} />
          <div className="fr-sheet" role="dialog" aria-label={INTRO.title}>
            <h2 className="fr-title">{INTRO.title}</h2>
            <p className="fr-sub">{INTRO.sub}</p>
            <button type="button" className="btn btn-primary btn-block fr-tap" onClick={() => setAt(0)}>
              {INTRO.show}
            </button>
            <button type="button" className="fr-link fr-tap" onClick={() => setAt('skipped')}>
              {INTRO.skip}
            </button>
          </div>
        </div>
      )}

      {(at === 'skipped' || at === 'done') && (
        <div className="lab-center">
          <MaprSays lines={[at === 'done' ? INTRO.done : INTRO.skipped]} />
          <p className="screen-subtitle">In the app, the Itinerary tab opens now.</p>
          <button type="button" className="btn btn-ghost btn-block fr-tap" onClick={restart}>
            {'\u{21BA}'} Restart
          </button>
        </div>
      )}

      {typeof at === 'number' && <TutorialStep i={at} onGo={setAt} />}
    </div>
  );
}

function TutorialStep({ i, onGo }) {
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const Mock = MOCKS[step.mock];
  return (
    <div className="tut nav-clear">
      <div className="fr-skipbar">
        <span className="tut-count" style={{ margin: 0, alignSelf: 'center' }}>
          Step {i + 1} of {STEPS.length}: <strong>{step.title}</strong>
        </span>
        <button type="button" className="fr-link" onClick={() => onGo('skipped')}>
          Skip tutorial
        </button>
      </div>
      <div className="tut-phone" key={step.id}>
        <Mock />
      </div>
      <MaprSays lines={step.say} />
      <div className="tut-actions">
        <button type="button" className="btn btn-ghost fr-tap" disabled={i === 0} onClick={() => onGo(i - 1)}>
          {'\u{2190}'} Back
        </button>
        <button type="button" className="btn btn-primary fr-tap" onClick={() => onGo(last ? 'done' : i + 1)}>
          {last ? 'Finish' : 'Next'} {'\u{2192}'}
        </button>
      </div>
    </div>
  );
}
