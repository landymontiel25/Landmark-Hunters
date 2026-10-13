import { useState } from 'react';
import { SwipeCardStack } from './OnboardingSteps';

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

// Practice cards: something nearly everyone has a clear answer to.
const practice = (word, icon, group) => ({ word, icon, group, photos: [], tag: null });
const TASKS = [
  { card: practice('Ice cream', '\u{1F366}', 'food'), want: 'love', ask: 'Try it: swipe right (or tap \u{2665}) on Ice cream.' },
  { card: practice('Traffic jams', '\u{1F697}', 'local'), want: 'dislike', ask: 'Now swipe left (or tap \u{2715}) on Traffic jams.' },
  { card: practice('Opera', '\u{1F3AD}', 'entertainment'), want: 'unsure', ask: "Last one: tap the card (or the \u{2212}) if you're not sure about Opera." },
];
const NAMES = { love: 'a love it', dislike: 'a nope', unsure: 'a not sure' };
const HOW = { love: 'swipe right', dislike: 'swipe left', unsure: 'tap the card' };

// Onboarding's how-to, led by Mapr (Test tab): Mapr says hello, explains the
// three answers, then has you practice each one on a sample card, cheering
// each right move. Nothing from practice is saved.
export default function MaprTutorial({ onDone }) {
  const [step, setStep] = useState(0); // 0 intro, 1..3 tasks, 4 ready
  const [feedback, setFeedback] = useState(null);
  const task = TASKS[step - 1];

  if (step === 0) {
    return (
      <div className="lab-center nav-clear">
        <MaprBubble>
          <strong>Hello! I'm Mapr, your personal AI assistant.</strong> {'\u{1F44B}'}
        </MaprBubble>
        <MaprBubble>
          I'm going to show you some cards so I can learn what you like. Swipe right if you love it, swipe left if it's not for you, or tap the card if you're not sure.
        </MaprBubble>
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

  if (step > TASKS.length) {
    return (
      <div className="lab-center nav-clear">
        <MaprBubble>
          <strong>You've got it!</strong> {'\u{1F389}'} Now the real cards. There are no wrong answers, and every swipe teaches me what to pick for you.
        </MaprBubble>
        <button type="button" className="btn btn-primary btn-block" onClick={onDone}>
          Start {'\u{2192}'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <MaprBubble>{feedback || task.ask}</MaprBubble>
      <SwipeCardStack
        key={step}
        practice
        labels
        cards={[task.card]}
        answers={[]}
        onAnswer={(card, answer) => {
          if (answer === task.want) {
            setFeedback('Good job! \u{1F389}');
            setTimeout(() => {
              setFeedback(null);
              setStep((s) => s + 1);
            }, 900);
          } else {
            setFeedback(`Almost! That was ${NAMES[answer]}. To answer this one, ${HOW[task.want]}.`);
          }
        }}
        onUndo={() => {}}
        onFinished={() => {}}
      />
      <button type="button" className="btn btn-ghost btn-sm lab-undo" onClick={() => setStep(TASKS.length + 1)}>
        Skip practice
      </button>
    </div>
  );
}
