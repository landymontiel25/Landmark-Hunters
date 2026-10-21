import { useState } from 'react';
import { MaprBubble } from '../components/MaprTutorial';
import { TUTORIAL_STEPS } from './signupTutorialSteps';

// Test tab "Tutorial" bubble: Mapr walks through sign-up and the first
// minutes in the app, one step at a time, each with a small drawn screen.
// Nothing is created or saved. The words live in signupTutorialSteps.js.

const NAV = [
  { label: 'Map', icon: '\u{1F310}' },
  { label: 'Places', icon: '\u{1F4CD}' },
  { label: 'Mapr', icon: '\u{1F9E0}' },
  { label: 'Itinerary', icon: '\u{1F5FA}\u{FE0F}' },
  { label: 'Profile', icon: '\u{1F3C6}' },
];

function MockField({ label, value }) {
  return (
    <div className="tut-field">
      <span>{label}</span>
      <div className="tut-input">{value}</div>
    </div>
  );
}

const MOCKS = {
  hello: () => (
    <div className="tut-hero" aria-hidden="true">
      {'\u{1F9ED}'}
    </div>
  ),
  signup: () => (
    <>
      <div className="tut-screen-title">{'\u{1F6C2}'} Sign In</div>
      <MockField label="Display Name" value="Alex" />
      <MockField label="Email" value="alex@example.com" />
      <MockField label="Password" value={'••••••••'} />
      <div className="tut-check">{'☑'} I am 13 years of age or older.</div>
      <div className="tut-btn tut-btn-primary tut-pulse">Create Account</div>
      <div className="tut-or">or</div>
      <div className="tut-btn">{'\u{1F510}'} Sign up with Google</div>
    </>
  ),
  verify: () => (
    <>
      <div className="tut-hero" aria-hidden="true">
        {'\u{1F4E7}'}
      </div>
      <div className="tut-screen-title">Verify your email</div>
      <p className="tut-small">We sent a link to alex@example.com</p>
      <div className="tut-btn">Resend email</div>
    </>
  ),
  rate: () => (
    <>
      <div className="tut-progress">
        <div style={{ width: '30%' }} />
      </div>
      <p className="tut-small">3 of 10</p>
      <div className="tut-place">
        <div className="tut-photo" aria-hidden="true">
          {'\u{1F3DB}\u{FE0F}'}
        </div>
        <strong>Sample Museum</strong>
        <span className="tut-small">Downtown</span>
      </div>
      <div className="tut-btn tut-btn-primary">I loved it</div>
      <div className="tut-btn">Ok</div>
      <div className="tut-btn">I didn't like it</div>
      <p className="tut-small">Haven't been / not sure</p>
    </>
  ),
  checkin: () => (
    <>
      <div className="tut-screen-title">{'\u{1F4CD}'} Your First Check-In</div>
      <div className="tut-place">
        <div className="tut-photo" aria-hidden="true">
          {'\u{1F5FD}'}
        </div>
        <strong>Sample Landmark</strong>
        <span className="tut-small">You're here</span>
      </div>
      <div className="tut-btn tut-btn-primary tut-pulse">Check In</div>
      <p className="tut-small">Skip for now</p>
    </>
  ),
  location: () => (
    <div className="tut-dialog">
      <strong>Allow "Landmark Hunters" to use your location?</strong>
      <div className="tut-dialog-btn">Keep Only While Using</div>
      <div className="tut-dialog-btn tut-pulse">Change to Always Allow</div>
    </div>
  ),
  tabs: (step) => (
    <>
      <div className="tut-hero" aria-hidden="true">
        {NAV.find((n) => n.label === step.tab)?.icon}
      </div>
      <div className="tut-screen-title">{step.tab}</div>
      <div className="tut-nav">
        {NAV.map((n) => (
          <div key={n.label} className={`tut-nav-item ${n.label === step.tab ? 'active' : ''}`}>
            <span aria-hidden="true">{n.icon}</span>
            <span>{n.label}</span>
          </div>
        ))}
      </div>
    </>
  ),
  swipe: () => (
    <>
      <div className="tut-place tut-swipe">
        <div className="tut-photo" aria-hidden="true">
          {'\u{1F366}'}
        </div>
        <strong>Ice cream</strong>
      </div>
      <div className="tut-swipe-row">
        <span>{'\u{2715}'}</span>
        <span>{'\u{2212}'}</span>
        <span>{'\u{2665}'}</span>
      </div>
    </>
  ),
  done: () => (
    <div className="tut-hero" aria-hidden="true">
      {'\u{1F389}'}
    </div>
  ),
};

export default function SignupTutorialLab() {
  const [i, setI] = useState(0);
  const step = TUTORIAL_STEPS[i];
  const last = i === TUTORIAL_STEPS.length - 1;
  const Mock = MOCKS[step.mock] || MOCKS.hello;

  return (
    <div className="tut nav-clear">
      <div className="tut-dots" role="tablist" aria-label="Tutorial steps">
        {TUTORIAL_STEPS.map((s, n) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={n === i}
            aria-label={`${n + 1}. ${s.title}`}
            className={`tut-dot ${n === i ? 'active' : ''} ${n < i ? 'done' : ''}`}
            onClick={() => setI(n)}
          />
        ))}
      </div>
      <p className="tut-count">
        Step {i + 1} of {TUTORIAL_STEPS.length}: <strong>{step.title}</strong>
      </p>
      <div className="tut-phone" key={step.id}>
        <Mock {...step} />
      </div>
      {step.say.map((line) => (
        <MaprBubble key={line}>{line}</MaprBubble>
      ))}
      <div className="tut-actions">
        <button type="button" className="btn btn-ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
          {'\u{2190}'} Back
        </button>
        {last ? (
          <button type="button" className="btn btn-primary" onClick={() => setI(0)}>
            {'\u{21BA}'} Start over
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setI(i + 1)}>
            Next {'\u{2192}'}
          </button>
        )}
      </div>
      {!last && (
        <button type="button" className="btn btn-ghost btn-sm tut-skip" onClick={() => setI(TUTORIAL_STEPS.length - 1)}>
          Skip tutorial
        </button>
      )}
    </div>
  );
}
