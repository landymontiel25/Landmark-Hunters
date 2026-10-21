import { useState } from 'react';
import { SwipeCardStack } from './OnboardingSteps';
import { PRACTICE, SAY } from '../screens/signupTutorialSteps';

// Mapr talking: its face and a speech bubble.
export function MaprBubble({ children }) {
  return (
    <div className="mapr-bubble">
      <span className="mapr-bubble-face" aria-hidden="true">
        {'\u{1F9E0}'}
      </span>
      <div className="mapr-bubble-text">{children}</div>
    </div>
  );
}

export function MaprSays({ lines }) {
  return lines.map((line) => <MaprBubble key={line}>{line}</MaprBubble>);
}

// Practice lines color the directions so they read at a glance: "right"
// green (love it), "left" red (nope). Lowercase only, so "Right answer"
// (meaning correct) stays plain.
function colorDirections(text) {
  return text.split(/\b(right|left)\b/).map((part, i) =>
    part === 'right' || part === 'left' ? (
      <span key={i} className={`mapr-dir mapr-dir-${part}`}>
        {part}
      </span>
    ) : (
      part
    )
  );
}

const NAMES = { love: 'a love it', dislike: 'a nope', unsure: 'a not sure' };
const WAYS = { swipe: 'a swipe', tap: 'a tap on the card', button: 'a button' };

// The tutorial's swipe practice (Test tab, step 4): Mapr has you answer a
// sample card each way, swiping right, swiping left, tapping the card, then
// tapping a button, and says what each one means. A right answer moves
// straight on to the next card (the answered card never comes back), with
// Mapr's "Good job" over it; a wrong one keeps the card for another try. The words are in
// screens/signupTutorialSteps.js. Nothing from practice is saved.
export default function MaprTutorial({ onDone }) {
  const [step, setStep] = useState(0); // 0 intro, 1..PRACTICE.length tasks, then ready
  const [feedback, setFeedback] = useState(null); // a wrong try on this card
  const [praise, setPraise] = useState(null); // the last card's "Good job"
  const task = PRACTICE[step - 1];

  if (step === 0) {
    return (
      <div className="lab-center nav-clear">
        <MaprSays lines={SAY.howtoIntro} />
        <ul className="mapr-legend">
          <li>
            <span>{'\u{2665}'}</span> Love it
          </li>
          <li>
            <span>{'\u{2715}'}</span> Nope
          </li>
          <li>
            <span>{'\u{2212}'}</span> Not sure
          </li>
        </ul>
        <button type="button" className="btn btn-primary btn-block" onClick={() => setStep(1)}>
          Let's practice {'\u{2192}'}
        </button>
      </div>
    );
  }

  if (step > PRACTICE.length) {
    return (
      <div className="lab-center nav-clear">
        {praise && <MaprBubble>{colorDirections(praise)}</MaprBubble>}
        <MaprSays lines={SAY.howtoReady} />
        <button type="button" className="btn btn-primary btn-block" onClick={onDone}>
          Start {'\u{2192}'}
        </button>
      </div>
    );
  }

  return (
    <div>
      {praise && !feedback && <MaprBubble>{colorDirections(praise)}</MaprBubble>}
      <MaprBubble>{colorDirections(feedback || task.ask)}</MaprBubble>
      <p className="tut-count">
        Practice {step} of {PRACTICE.length}
      </p>
      <SwipeCardStack
        key={step}
        practice
        labels
        cards={[task.card]}
        answers={[]}
        onAnswer={(card, answer, how) => {
          if (answer === task.want && how === task.how) {
            setPraise(task.good);
            setFeedback(null);
            setStep((s) => s + 1);
          } else if (answer === task.want) {
            setFeedback(`Right answer, but that was ${WAYS[how]}. ${task.ask}`);
          } else {
            setFeedback(`Almost! That was ${NAMES[answer]}. ${task.ask}`);
          }
        }}
        onUndo={() => {}}
        onFinished={() => {}}
      />
      <button type="button" className="btn btn-ghost btn-sm lab-undo" onClick={() => {
          setPraise(null);
          setStep(PRACTICE.length + 1);
        }}>
        Skip practice
      </button>
    </div>
  );
}
