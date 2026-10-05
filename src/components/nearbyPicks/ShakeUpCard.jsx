import { useState } from 'react';

// "Shake things up?": shown in the picks sheet when Mapr sees a quiet week
// (fewer than 3 ratings and fewer than 5 places visited in 7 days, see
// src/lib/maprRank/exploration.js isStagnating). Mapr already mixes in more
// new places for this user; the button builds a fresh set right away.
// Dismissed for the day on this device.
const KEY = (uid) => `lh-shake-up-dismissed:${uid}`;
const today = () => new Date().toISOString().slice(0, 10);

function dismissedToday(uid) {
  try {
    return localStorage.getItem(KEY(uid)) === today();
  } catch {
    return false;
  }
}

export default function ShakeUpCard({ uid, show, onShake }) {
  const [hidden, setHidden] = useState(() => !uid || dismissedToday(uid));
  if (!show || hidden || !onShake) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(KEY(uid), today());
    } catch {
      /* private mode */
    }
  };
  return (
    <section className="mpp-section mpp-callout mpp-shake" aria-label="Shake things up">
      <h3 className="mpp-section-title">{'\u{1F3B2}'} Shake things up?</h3>
      <p className="mpp-shake-text">Quiet week. Mapr is mixing in more places you haven't tried.</p>
      <div className="mpp-shake-actions">
        <button
          type="button"
          className="mpp-shake-btn"
          onClick={() => {
            onShake();
            dismiss();
          }}
        >
          Show me something different
        </button>
        <button type="button" className="mpp-shake-dismiss" onClick={dismiss}>
          Not now
        </button>
      </div>
    </section>
  );
}
