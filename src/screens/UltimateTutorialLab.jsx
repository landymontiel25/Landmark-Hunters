import { useState } from 'react';
import { useGeo } from '../lib/GeoContext';
import { useRatings } from '../lib/RatingsContext';
import { useTrip } from '../lib/TripContext';
import { allSwipeCards } from '../lib/onboardingCards';
import { ALL_LANDMARKS } from '../data/regions';
import { PROGRESS_GOAL } from '../lib/firstRun';
import { SwipeCardStack } from '../components/OnboardingSteps';
import MaprTutorial, { MaprSays } from '../components/MaprTutorial';
import { LabNotes, LabSignUp, TutorialHello, TutorialLocation, TutorialTabs, TutorialVerify } from './SignupTutorialLab';
import { DistancePill, ProgressRing, TasteChips } from './FirstRunLab';
import { SAY } from './signupTutorialSteps';
import LabSummary from './TutorialSummary';

// Test tab "Planner tutorial" (owner, 2026-11-02; was "Ultimate
// tutorial"): Tutorial (T1) and
// Tutorial 2 (T2) combined in the owner's order, with Mapr explaining every
// step. Each step is the real piece from its tutorial, so a fix there shows
// here too:
//   1 Hello T1, 2 Sign up T1, 3 Verify email T1, 4 Swipe practice T1,
//   5 Cards T1, 6 Taste pick T2, 7 Anything else T1, 8 First check-in T2,
//   9 Progress T2, 10 Location T2, 11 Your tabs T2, 12 Done T1.
// The T2 steps had no Mapr; their lines are SAY.taste, SAY.checkinNear and
// SAY.progress. Like both tutorials, nothing is saved: the results screen
// shows what a real signup would have saved.
const ULTIMATE_STEPS = [
  { id: 'hello', label: 'Hello', from: 'T1' },
  { id: 'signup', label: 'Sign up', from: 'T1' },
  { id: 'verify', label: 'Verify email', from: 'T1' },
  { id: 'howto', label: 'Swipe practice', from: 'T1' },
  { id: 'cards', label: 'Cards', from: 'T1' },
  { id: 'taste', label: 'Taste pick', from: 'T2' },
  { id: 'notes', label: 'Anything else', from: 'T1' },
  { id: 'checkin', label: 'First check-in', from: 'T2' },
  { id: 'progress', label: 'Progress', from: 'T2' },
  { id: 'location', label: 'Location', from: 'T2' },
  { id: 'tabs', label: 'Your tabs', from: 'T2' },
  { id: 'done', label: 'Done', from: 'T1' },
];

// "Pretend I'm at the place" with location off: you're at this one.
const PRETEND_PLACE = ALL_LANDMARKS.find((l) => l.images?.length) || ALL_LANDMARKS[0];

const empty = () => ({
  name: '',
  email: '',
  password: '',
  age: false,
  via: null,
  skippedRating: false,
  places: [],
  // Every card, like Tutorial, so each one gets tried; real signups get 15-18.
  cards: allSwipeCards(),
  answers: [],
  chips: null,
  notes: '',
  checkedIn: false,
});

export default function UltimateTutorialLab() {
  const { coords } = useGeo();
  const { myReviews } = useRatings();
  const { trip } = useTrip();
  const [step, setStep] = useState(0);
  const [data, setData] = useState(empty);
  const [log, setLog] = useState([]);
  const [pretend, setPretend] = useState(false);
  const set = (patch) => setData((d) => ({ ...d, ...patch }));
  const note = (text) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} — ${text}`]);
  const indexOf = (id) => ULTIMATE_STEPS.findIndex((s) => s.id === id);
  const go = (target, why) => {
    const i = typeof target === 'string' ? indexOf(target) : target;
    const next = Math.max(0, Math.min(ULTIMATE_STEPS.length - 1, i));
    note(`${why}: ${ULTIMATE_STEPS[step].label} → ${ULTIMATE_STEPS[next].label}`);
    setStep(next);
  };
  const restart = () => {
    setData(empty());
    setLog([]);
    setStep(0);
  };

  const id = ULTIMATE_STEPS[step].id;
  // Progress counts the account's own ratings plus the cards loved or
  // disliked here (pretend: nothing is saved).
  const rated = Object.keys(myReviews || {}).length + data.answers.filter((a) => a.answer !== 'unsure').length;

  return (
    <div>
      <div className="card section lab-controls">
        <div className="lab-controls-head">
          <strong>{'\u{1F9EA}'} Planner tutorial test</strong>
          <span className="tag">Nothing here is saved</span>
        </div>
        <div className="lab-steps">
          {ULTIMATE_STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`lab-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
              title={`From ${s.from === 'T1' ? 'Tutorial' : 'Tutorial 2'}`}
              onClick={() => go(i, 'Jumped')}
            >
              {i + 1}. {s.label} <small>{s.from}</small>
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
          <button type="button" className="btn btn-ghost btn-sm" disabled={step === ULTIMATE_STEPS.length - 1} onClick={() => go(step + 1, 'Next step')}>
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
      {id === 'verify' && <TutorialVerify email={data.email} onDone={() => go('howto', 'Verified email (pretend)')} />}
      {id === 'howto' && <MaprTutorial onDone={() => go('cards', 'Finished swipe practice')} />}
      {id === 'cards' && data.answers.length < data.cards.length && <MaprSays lines={SAY.cards} />}
      {id === 'cards' && (
        <SwipeCardStack
          labels
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
          onSkip={() => {
            set({ skippedRating: !data.answers.length });
            go('taste', `Skipped cards after ${data.answers.length}`);
          }}
          onFinished={() => go('taste', 'Finished cards')}
        />
      )}
      {id === 'taste' && (
        <>
          <MaprSays lines={SAY.taste} />
          <TasteChips
            saved={trip?.savedInterests || []}
            onNext={(chips) => {
              set({ chips });
              go('notes', `Picked ${chips.length} kinds of places`);
            }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-block"
            style={{ marginTop: 10 }}
            onClick={() => {
              set({ chips: [] });
              go('notes', 'Skipped taste pick');
            }}
          >
            Skip for now
          </button>
        </>
      )}
      {id === 'notes' && (
        <>
          <MaprSays lines={SAY.notes} />
          <LabNotes data={data} set={set} onDone={(how) => go('checkin', how)} />
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
              set({ checkedIn: true });
              go('progress', `Checked in at ${place.name} (pretend)`);
            }}
          />
          <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => go('progress', 'Skipped first check-in')}>
            Skip for now
          </button>
        </>
      )}
      {id === 'progress' && (
        <>
          <MaprSays lines={data.checkedIn ? [...SAY.progress, ...SAY.progressCheckedIn] : SAY.progress} />
          <ProgressRing count={Math.min(PROGRESS_GOAL, rated)} goal={PROGRESS_GOAL} checkedIn={data.checkedIn} />
          <button type="button" className="btn btn-primary btn-block fr-tap" onClick={() => go('location', 'Saw progress')}>
            Next
          </button>
        </>
      )}
      {id === 'location' && <TutorialLocation onDone={() => go('tabs', 'Saw the location ask')} />}
      {id === 'tabs' && <TutorialTabs onDone={() => go('done', 'Finished your tabs')} />}
      {id === 'done' && <MaprSays lines={SAY.done} />}
      {id === 'done' && <LabSummary data={data} log={log} onRestart={restart} showPlaces={false} />}
    </div>
  );
}
