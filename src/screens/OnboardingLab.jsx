import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useGeo } from '../lib/GeoContext';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { isAdmin } from '../lib/admins';
import { ALL_LANDMARKS, INTERESTS } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import { allSwipeCards, tagDeltasFromAnswers, tasteIntroFromAnswers, SWIPE_DELTAS, PLACE_DELTA } from '../lib/onboardingCards';
import OnboardingPlaces from '../components/OnboardingPlaces';
import LandmarkThumb from '../components/LandmarkThumb';
import { SwipeCardStack as LabCardStack, progressTier } from '../components/OnboardingSteps';
import MaprTutorial, { MaprSays } from '../components/MaprTutorial';
import { NOTHING_TO_TEST } from './onboardingLabConfig';
import MallLab from './MallLab';
import TasteProfileLab from './TasteProfileLab';
import RatingSliderLab from './RatingSliderLab';
import { LabNotes, LabSignUp, TutorialHello, TutorialLocation, TutorialTabs, TutorialVerify } from './SignupTutorialLab';
import { SAY, TUTORIAL_STEPS } from './signupTutorialSteps';
import FirstRunLab from './FirstRunLab';
import ItineraryTutorialLab from './ItineraryTutorialLab';

export { progressTier };

// Admin-only sandbox for the Tutorial: sign-up and onboarding combined into
// one Mapr-led flow (hello, sign up, verify, swipe practice, the cards, notes,
// your places, first check-in, location, your tabs). Everything here is local
// state: no account is created, nothing is written to Firestore or the saved
// trip, and "Restart" wipes it. The results screen shows what a real signup
// would have saved (tagScores changes and notes) without saving it. The step
// order and Mapr's words live in signupTutorialSteps.js. Tutorial 2 is a
// different flow, the First-Run Tutorial Build Guide (FirstRunLab.jsx).
const STEPS = TUTORIAL_STEPS;
// The Test tab's sub-tabs, shown as floating bubbles above the test. Add an
// entry here (and render it below) for each new test.
const TESTS = [
  { id: 'slider', label: 'Rating slider' },
  { id: 'malls', label: 'Malls' },
  { id: 'tutorial', label: 'Tutorial' },
  { id: 'tutorial2', label: 'Tutorial 2' },
  { id: 'itinerary', label: 'Itinerary tutorial' },
  { id: 'taste', label: 'Taste Profile' },
];

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
  const [test, setTest] = useState('slider');

  if (authLoading) return null;
  if (!isAdmin(user?.email)) return <Navigate to="/" replace />;

  const testTabs = (
    <div className="lab-tabs" role="tablist" aria-label="Tests">
      {TESTS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={test === t.id}
          className={`lab-tab ${test === t.id ? 'active' : ''}`}
          onClick={() => setTest(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (test === 'slider') {
    return (
      <div>
        {testTabs}
        <RatingSliderLab />
      </div>
    );
  }

  if (test === 'malls') {
    return (
      <div>
        {testTabs}
        <MallLab uid={user?.uid} />
      </div>
    );
  }

  if (test === 'tutorial2') {
    return (
      <div>
        {testTabs}
        <FirstRunLab />
      </div>
    );
  }

  if (test === 'itinerary') {
    return (
      <div>
        {testTabs}
        <ItineraryTutorialLab />
      </div>
    );
  }

  if (test === 'taste') {
    return (
      <div>
        {testTabs}
        <TasteProfileLab />
      </div>
    );
  }

  if (NOTHING_TO_TEST) {
    return (
      <div className="lab-center">
        {testTabs}
        <h1 className="screen-title">
          <span>{'\u{1F9EA}'}</span> Nothing to test
        </h1>
        <p className="screen-subtitle">There's no new onboarding to try right now. This tab will come back when there is.</p>
      </div>
    );
  }

  return (
    <div>
      {testTabs}
      <TutorialFlow />
    </div>
  );
}

// One run of the Tutorial, from hello to the results.
function TutorialFlow() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState(empty);
  const [log, setLog] = useState([]);
  const set = (patch) => setData((d) => ({ ...d, ...patch }));
  const note = (text) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} — ${text}`]);
  const indexOf = (id) => STEPS.findIndex((s) => s.id === id);

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
      <div className="card section lab-controls">
        <div className="lab-controls-head">
          <strong>{'\u{1F9EA}'} Tutorial test</strong>
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
        <LabCardStack
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
            go('notes', `Skipped cards after ${data.answers.length}`);
          }}
          onFinished={() => go('notes', 'Finished cards')}
        />
      )}
      {id === 'notes' && (
        <>
          <MaprSays lines={SAY.notes} />
          <LabNotes data={data} set={set} onDone={(how) => go('places', how)} />
        </>
      )}
      {id === 'places' && (
        <>
          <MaprSays lines={SAY.places} />
          <OnboardingPlaces
            places={data.places}
            onChange={(places, what) => {
              note(what);
              set({ places });
            }}
            onDone={() => go('checkin', data.places.length ? `Added ${data.places.length} places` : 'Skipped places')}
          />
        </>
      )}
      {id === 'checkin' && (
        <>
          <MaprSays lines={SAY.checkin} />
          <LabCheckIn data={data} set={set} onDone={(how) => go('location', how)} />
        </>
      )}
      {id === 'location' && <TutorialLocation onDone={() => go('tabs', 'Saw the location ask')} />}
      {id === 'tabs' && <TutorialTabs onDone={() => go('done', 'Finished your tabs')} />}
      {id === 'done' && <MaprSays lines={SAY.done} />}
      {id === 'done' && <LabSummary data={data} log={log} onRestart={restart} />}
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
  const deltas = tagDeltasFromAnswers(data.answers, data.places);
  const intro = tasteIntroFromAnswers(data.answers, data.notes, data.places);
  const count = (a) => data.answers.filter((x) => x.answer === a).length;
  const answerLabel = { love: 'love it', dislike: "don't like it", unsure: 'not sure' };
  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F3C1}'}</span> Tutorial finished
      </h1>
      <p className="screen-subtitle">What a real signup would have saved. Nothing here was actually saved.</p>
      <div className="card section">
        <p>
          <strong>Signed up with:</strong> {data.via || '—'}
        </p>
        {data.skippedRating ? (
          <p>
            <strong>Cards:</strong> skipped, no preference data yet
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
              {SWIPE_DELTAS.love}, don't like it {SWIPE_DELTAS.dislike}, not sure 0, each place you visit most{' '}
              {PLACE_DELTA > 0 ? '+' : ''}
              {PLACE_DELTA} on each of its tags — summed per tag.
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
            <strong>What Mapr reads</strong>
            <p className="screen-subtitle" style={{ margin: '4px 0 0' }}>
              {intro || 'nothing'}
            </p>
            <p className="screen-subtitle" style={{ fontSize: '0.75rem' }}>
              The same text goes to every Mapr surface: the Map sheet, Travel Picks, chat, the trip planner and the landmark list.
            </p>
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
