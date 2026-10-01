import { useEffect, useMemo } from 'react';

const COLORS = ['#ff3d71', '#ffb020', '#ffe94d', '#3ddc84', '#38bdf8', '#a78bfa', '#ff7ab6', '#ffffff'];
const PIECES = 56;
const AUTO_DISMISS_MS = 2600;

// The full-screen "YOU CHECKED IN!" blast: a burst of confetti, expanding
// rings and a big rainbow title, shown the moment a check-in posts. Tap
// anywhere (or wait) and it hands off to the normal "Checked in! +100"
// panel underneath. Purely celebratory -- nothing here is interactive
// beyond dismissing it.
export default function CheckInBlast({ landmarkName, points = 100, message, onDone }) {
  // Randomize once per mount so every check-in's burst looks different,
  // but a re-render mid-animation doesn't reshuffle the pieces.
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => {
        const angle = (i / PIECES) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 38 + Math.random() * 42; // vh/vw units, past the screen edge
        return {
          id: i,
          style: {
            '--dx': `${Math.cos(angle) * dist}vw`,
            '--dy': `${Math.sin(angle) * dist}vh`,
            '--rot': `${Math.round(Math.random() * 1080 - 540)}deg`,
            '--delay': `${Math.round(Math.random() * 180)}ms`,
            '--size': `${8 + Math.round(Math.random() * 10)}px`,
            background: COLORS[i % COLORS.length],
            borderRadius: i % 3 === 0 ? '50%' : '2px',
          },
        };
      }),
    []
  );

  useEffect(() => {
    const t = setTimeout(onDone, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="checkin-blast" onClick={onDone} role="presentation">
      <span className="blast-ring" aria-hidden="true" />
      <span className="blast-ring blast-ring-2" aria-hidden="true" />
      <span className="blast-ring blast-ring-3" aria-hidden="true" />
      <span className="blast-pieces" aria-hidden="true">
        {pieces.map((p) => (
          <span key={p.id} className="blast-piece" style={p.style} />
        ))}
      </span>
      <div className="blast-body">
        <div className="blast-pin">{'\u{1F4CD}'}</div>
        <h1 className="blast-title">YOU CHECKED IN!</h1>
        <p className="blast-name">{landmarkName}</p>
        {points > 0 && <p className="blast-points">+{points} pts</p>}
        {message && <p className="blast-message">{message}</p>}
      </div>
    </div>
  );
}
