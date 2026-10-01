import { useRef, useState } from 'react';

// The pieces of onboarding shared by the real flow (screens/Onboarding) and
// the Test tab sandbox (screens/OnboardingLab), so a change made here shows
// up in both.

export function HowToStep({ onNext }) {
  return (
    <div className="lab-center nav-clear">
      <h1 className="screen-title">Quick picks so Mapr gets you.</h1>
      <ul className="lab-howto">
        <li>
          <span>{'\u{2665}'}</span> Love it: swipe right or tap {'\u{2665}'}
        </li>
        <li>
          <span>{'\u{2715}'}</span> Don't like it: swipe left or tap {'\u{2715}'}
        </li>
        <li>
          <span>{'\u{2212}'}</span> Not sure or don't care (you'll be asked again later): tap the card or tap {'\u{2212}'}
        </li>
      </ul>
      <button type="button" className="btn btn-primary btn-block" onClick={onNext}>
        Start {'\u{2192}'}
      </button>
    </div>
  );
}

// Red for the first third, yellow to two thirds, green after, emerald when done.
export function progressTier(done, total) {
  if (total && done >= total) return 'done';
  const f = total ? done / total : 0;
  return f < 1 / 3 ? 'red' : f < 2 / 3 ? 'yellow' : 'green';
}

export function OnboardingProgress({ done, total }) {
  const tier = progressTier(done, total);
  const label = `${total ? Math.round((done / total) * 100) : 0}%`;
  return (
    <div className="lab-progress-wrap">
      <p className={`lab-progress lab-tier-${tier}`}>{label}</p>
      <div className="lab-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <span className={`lab-tier-${tier}`} style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

const SWIPE_PX = 90;
const TAP_PX = 8;

// onSkip (optional) adds a "Skip this step" button under the cards; answers given so far are kept.
export function SwipeCardStack({ cards, answers, onAnswer, onUndo, onFinished, onSkip }) {
  const answered = new Set(answers.map((a) => a.card.word));
  const index = cards.findIndex((c) => !answered.has(c.word));
  const card = index === -1 ? null : cards[index];
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(null);
  const start = useRef(null);

  if (!card) {
    return (
      <div className="lab-center nav-clear">
        <OnboardingProgress done={answers.length} total={cards.length} />
        <h1 className="screen-title">All done {'\u{2705}'}</h1>
        <p className="screen-subtitle">{answers.length} cards rated.</p>
        <button type="button" className="btn btn-primary btn-block" onClick={onFinished}>
          Continue {'\u{2192}'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm lab-undo" disabled={!answers.length} onClick={onUndo}>
          {'\u{21B6}'} Undo
        </button>
      </div>
    );
  }

  const decide = (answer) => {
    if (leaving) return;
    setLeaving(answer);
    setDx(answer === 'love' ? 600 : answer === 'dislike' ? -600 : 0);
    setTimeout(() => {
      onAnswer(card, answer);
      setDx(0);
      setLeaving(null);
    }, 220);
  };

  const onPointerDown = (e) => {
    if (leaving) return;
    start.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!start.current) return;
    setDx(e.clientX - start.current.x);
  };
  const onPointerUp = (e) => {
    if (!start.current) return;
    const moved = e.clientX - start.current.x;
    const movedY = e.clientY - start.current.y;
    start.current = null;
    if (moved > SWIPE_PX) decide('love');
    else if (moved < -SWIPE_PX) decide('dislike');
    else if (Math.abs(moved) < TAP_PX && Math.abs(movedY) < TAP_PX) decide('unsure');
    else setDx(0);
  };

  const hint = dx > 30 ? 'love' : dx < -30 ? 'dislike' : null;

  return (
    <div className="nav-clear">
      <OnboardingProgress done={answers.length} total={cards.length} />
      <div className="lab-card-area">
        <div
          className={`lab-card ${leaving ? 'leaving' : ''} ${dx !== 0 && !leaving ? 'dragging' : ''}`}
          style={{ transform: `translateX(${dx}px) rotate(${dx / 20}deg)`, opacity: leaving === 'unsure' ? 0 : 1 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            start.current = null;
            setDx(0);
          }}
          role="group"
          aria-label={`${card.word}. Swipe right to love it, left if you don't like it, or tap if you're not sure or don't care.`}
        >
          <div className="lab-card-word">{card.word}</div>
          <div className={`lab-card-photo lab-photo-${card.group} ${card.photos.length > 1 ? 'split' : ''}`}>
            <span aria-hidden="true">{card.icon}</span>
            {card.photos.map((src) => (
              <img
                key={src}
                src={src}
                alt=""
                draggable={false}
                style={card.photoPosition ? { objectPosition: card.photoPosition } : undefined}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ))}
          </div>
          {cards[index + 1]?.photos.map((src) => <link key={src} rel="preload" as="image" href={src} />)}
          {hint && <div className={`lab-card-hint ${hint}`}>{hint === 'love' ? 'LOVE IT' : 'NOPE'}</div>}
        </div>
      </div>
      <div className="lab-card-buttons">
        <button type="button" className="btn btn-ghost" onClick={() => decide('dislike')} aria-label="Don't like it">
          {'\u{2715}'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => decide('unsure')} aria-label="Not sure">
          {'\u{2212}'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => decide('love')} aria-label="Love it">
          {'\u{2665}'}
        </button>
      </div>
        <button type="button" className="btn btn-ghost btn-sm lab-undo" disabled={!answers.length || !!leaving} onClick={onUndo}>
          {'\u{21B6}'} Undo
        </button>
      {onSkip && (
        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} disabled={!!leaving} onClick={onSkip}>
          Skip this step
        </button>
      )}
    </div>
  );
}
