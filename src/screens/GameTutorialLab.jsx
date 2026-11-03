import { useState } from 'react';
import { useGeo } from '../lib/GeoContext';
import { ALL_LANDMARKS } from '../data/regions';
import { MaprSays } from '../components/MaprTutorial';
import { LabSignUp, TutorialHello, TutorialTabs, TutorialVerify } from './SignupTutorialLab';
import { DistancePill } from './FirstRunLab';
import ExplainerImagesLab from './ExplainerImagesLab';
import { SAY } from './signupTutorialSteps';

// Test tab "Game tutorial" (owner, 2026-11-02): onboarding for the game
// only, no planner or taste steps, with Mapr explaining every step: Hello,
// Sign up, Verify email (Tutorial), the 5 images intro (Discover, Arrive
// prepared, Plan Less, Play, Remember; Mapr says SAY.images[screen] on
// each), First check-in (Tutorial 2's distance check, Mapr's
// SAY.checkinNear), Your tabs, Done (Tutorial). Each step is the real piece
// from where it came from. Nothing is saved.
const STEPS = [
  { id: 'hello', label: 'Hello' },
  { id: 'signup', label: 'Sign up' },
  { id: 'verify', label: 'Verify email' },
  { id: 'images', label: '5 images' },
  { id: 'checkin', label: 'First check-in' },
  { id: 'tabs', label: 'Your tabs' },
  { id: 'done', label: 'Done' },
];

// "Pretend I'm at the place" with location off: you're at this one.
const PRETEND_PLACE = ALL_LANDMARKS.find((l) => l.images?.length) || ALL_LANDMARKS[0];

const empty = () => ({ name: '', email: '', password: '', age: false, via: null, intro: null, checkedIn: null });

export default function GameTutorialLab() {
  const { coords } = useGeo();
  const [step, setStep] = useState(0);
  const [data, setData] = useState(empty);
  const [log, setLog] = useState([]);
  const [pretend, setPretend] = useState(false);
  const [slide, setSlide] = useState('discover');
  const set = (patch) => setData((d) => ({ ...d, ...patch }));
  const note = (text) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} — ${text}`]);
  const go = (target, why) => {
    const i = typeof target === 'string' ? STEPS.findIndex((s) => s.id === target) : target;
    const next = Math.max(0, Math.min(STEPS.length - 1, i));
    note(`${why}: ${STEPS[step].label} → ${STEPS[next].label}`);
    setStep(next);
  };
  const restart = () => {
    setData(empty());
    setLog([]);
    setSlide('discover');
    setStep(0);
  };
  const id = STEPS[step].id;

  return (
    <div>
      <div className="card section lab-controls">
        <div className="lab-controls-head">
          <strong>{'\u{1F9EA}'} Game tutorial test</strong>
          <span className="tag">Nothing here is saved</span>
        </div>
        <div className="lab-steps">
          {STEPS.map((s, i) => (
            <button key={s.id} type="button" className={`lab-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} onClick={() => go(i, 'Jumped')}>
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
          <button type="button" className="btn btn-ghost btn-sm" disabled={step === STEPS.length - 1} onClick={() => go(step + 1, 'Next step')}>
            Next step {'\u{2192}'}
          </button>
        </div>
        <div className="lab-actions" style={{ marginTop: 8 }}>
          <label className="fr-toggle">
            <input type="checkbox" checked={pretend} onChange={(e) => setPretend(e.target.checked)} /> Pretend I'm at the place
          </label>
        </div>
      </div>

      {id === 'hello' && <TutorialHello onDone={() => go('signup', 'Met Mapr')} />}
      {id === 'signup' && (
        <>
          <MaprSays lines={SAY.signup} />
          <LabSignUp
            data={data}
            set={set}
            onDone={(via) => {
              set({ via });
              go('verify', `Signed up (${via})`);
            }}
          />
        </>
      )}
      {id === 'verify' && <TutorialVerify email={data.email} onDone={() => go('images', 'Verified email (pretend)')} />}
      {id === 'images' && (
        <>
          <MaprSays lines={SAY.images[slide] || []} />
          <ExplainerImagesLab
            coords={coords}
            onSlide={setSlide}
            onDone={(how) => {
              set({ intro: how });
              go('checkin', how === 'skipped' ? 'Skipped the 5 images' : 'Watched the 5 images');
            }}
          />
        </>
      )}
      {id === 'checkin' && (
        <>
          <MaprSays lines={SAY.checkinNear} />
          <DistancePill
            coords={coords}
            pretend={pretend}
            fallback={PRETEND_PLACE}
            onCheckIn={(place) => {
              set({ checkedIn: place.name });
              go('tabs', `Checked in at ${place.name} (pretend)`);
            }}
          />
          <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => go('tabs', 'Skipped first check-in')}>
            Skip for now
          </button>
        </>
      )}
      {id === 'tabs' && <TutorialTabs onDone={() => go('done', 'Finished your tabs')} />}
      {id === 'done' && (
        <div>
          <MaprSays lines={SAY.done} />
          <h1 className="screen-title">
            <span>{'\u{1F3C1}'}</span> Tutorial finished
          </h1>
          <p className="screen-subtitle">What happened in this run. Nothing was saved.</p>
          <div className="card section">
            <p>
              <strong>Signed up with:</strong> {data.via || '—'}
            </p>
            <p>
              <strong>5 images:</strong> {data.intro === 'finished' ? 'watched all 5' : data.intro === 'skipped' ? 'skipped' : '—'}
            </p>
            <p>
              <strong>First check-in:</strong> {data.checkedIn || 'skipped'}
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
          <button type="button" className="btn btn-primary btn-block" onClick={restart}>
            {'\u{21BA}'} Restart
          </button>
        </div>
      )}
    </div>
  );
}
