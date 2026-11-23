import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

const SPARKS = 18;
export const MISSION_COMPLETE_MS = 3000;

// The "Mission completed" moment (owner, 2026-11-23): its own celebration,
// kin to the check-in blast but quieter and all gold, the design
// language's color for your progress. A gold seal draws its ring, fills
// and checks itself, one shockwave and a short burst of gold sparks go
// out, then the title and the points pill. It plays once, never loops,
// and closes on a tap, Escape, or by itself. Reduced motion: a plain fade.
export default function MissionComplete({ landmarkName, points = 0, onDone }) {
  // Random once per mount: every completion's burst looks a little different.
  const sparks = useMemo(
    () =>
      Array.from({ length: SPARKS }, (_, i) => {
        const angle = (i / SPARKS) * Math.PI * 2 + Math.random() * 0.3;
        const dist = 90 + Math.random() * 70;
        return {
          id: i,
          style: {
            '--dx': `${Math.round(Math.cos(angle) * dist)}px`,
            '--dy': `${Math.round(Math.sin(angle) * dist)}px`,
            '--delay': `${380 + Math.round(Math.random() * 120)}ms`,
            '--size': `${5 + Math.round(Math.random() * 5)}px`,
          },
        };
      }),
    []
  );

  useEffect(() => {
    const t = setTimeout(onDone, MISSION_COMPLETE_MS);
    const onKey = (e) => e.key === 'Escape' && onDone();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [onDone]);

  const body = (
    <div className="mc-overlay" onClick={onDone} role="status" aria-live="polite">
      <div className="mc-stage">
        <span className="mc-wave" aria-hidden="true" />
        <span className="mc-sparks" aria-hidden="true">
          {sparks.map((s) => (
            <span key={s.id} className="mc-spark" style={s.style} />
          ))}
        </span>
        <svg className="mc-seal" viewBox="0 0 120 120" aria-hidden="true">
          <circle className="mc-seal-fill" cx="60" cy="60" r="50" />
          <circle className="mc-seal-ring" cx="60" cy="60" r="54" pathLength="1" />
          <path className="mc-seal-check" d="M38 61 L53 76 L83 45" pathLength="1" />
        </svg>
      </div>
      <h2 className="mc-title">Mission completed</h2>
      {landmarkName && <p className="mc-name">{landmarkName}</p>}
      {points > 0 && <p className="mc-points">+{points} points</p>}
    </div>
  );
  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}
