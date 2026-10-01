import { useEffect, useRef, useState } from 'react';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { maneuverIcon } from '../lib/navProgress';

const PREPARE_METERS = { WALK: 60, DRIVE: 300 };

function formatMinutes(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`;
}

function speak(text) {
  try {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch {
    /* no voice on this device -- the banner still shows it */
  }
}

// Keeps the screen on while navigating, like a maps app. Best effort.
function useWakeLock(active) {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return undefined;
    let lock = null;
    let released = false;
    const request = () =>
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (released) l.release();
          else lock = l;
        })
        .catch(() => {});
    request();
    // The lock drops whenever the page is hidden; take it back on return.
    const onVisible = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}

// Full-screen driving/walking mode over the Map: the next turn up top with
// a live distance countdown, time/distance/arrival at the bottom, spoken
// instructions, and -- on arrival -- the next itinerary stop if there is one.
export default function ActiveNavOverlay({
  dest,
  mode,
  progress,
  rerouting,
  following,
  onRecenter,
  onEnd,
  nextStop,
  onNextStop,
}) {
  const { units } = useUnits();
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem('lh-nav-muted') === '1';
    } catch {
      return false;
    }
  });
  useWakeLock(true);

  const toggleMute = () => {
    setMuted((m) => {
      try {
        localStorage.setItem('lh-nav-muted', m ? '0' : '1');
      } catch {
        /* private mode */
      }
      if (!m) window.speechSynthesis?.cancel();
      return !m;
    });
  };

  // Once you've arrived it stays arrived: GPS jitter at the door (or
  // wandering inside the building) must not flip the banner back to turns
  // and take the Next stop button away.
  const arrivedRef = useRef(false);
  if (progress?.arrived) arrivedRef.current = true;
  const arrived = arrivedRef.current;
  const nextText = progress?.next?.instruction || `Arrive at ${dest.name}`;

  // Say each instruction once when its step begins, and once more as the
  // turn gets close; then "You have arrived".
  const spokenRef = useRef({ step: null, prepared: null, arrived: false });
  useEffect(() => {
    if (!progress || muted) return;
    const s = spokenRef.current;
    if (progress.arrived) {
      if (!s.arrived) speak(`You have arrived at ${dest.name}`);
      s.arrived = true;
      return;
    }
    const dist = formatDistance(progress.metersToNext, units);
    if (s.step !== progress.stepIndex) {
      s.step = progress.stepIndex;
      s.prepared = null;
      speak(`In ${dist}, ${nextText}`);
    } else if (
      s.prepared !== progress.stepIndex &&
      progress.metersToNext <= (PREPARE_METERS[mode] || 150) &&
      progress.metersToNext > 15
    ) {
      s.prepared = progress.stepIndex;
      speak(`In ${dist}, ${nextText}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.stepIndex, progress?.metersToNext, progress?.arrived, muted]);

  const eta = progress
    ? new Date(Date.now() + progress.remainingSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <>
      <div className={`nav-banner ${arrived ? 'arrived' : ''}`} role="status" aria-live="polite">
        {arrived ? (
          <>
            <span className="nav-banner-icon">{'\u{1F3C1}'}</span>
            <div className="nav-banner-text">
              <strong>You've arrived</strong>
              <span>{dest.name}</span>
            </div>
          </>
        ) : !progress ? (
          <div className="nav-banner-text">
            <strong>Starting route…</strong>
          </div>
        ) : (
          <>
            <span className="nav-banner-icon">{progress.next ? maneuverIcon(progress.next.maneuver) : '\u{1F3C1}'}</span>
            <div className="nav-banner-text">
              <strong>{formatDistance(progress.metersToNext, units)}</strong>
              <span>{rerouting ? 'Rerouting…' : nextText}</span>
            </div>
          </>
        )}
      </div>

      <div className="nav-bottom">
        {arrived ? (
          <div className="nav-bottom-row">
            {nextStop ? (
              <button type="button" className="btn btn-primary" onClick={onNextStop}>
                Next: {nextStop.name} {'\u{25B6}'}
              </button>
            ) : null}
            <button type="button" className={`btn ${nextStop ? 'btn-ghost' : 'btn-primary'}`} onClick={onEnd}>
              {nextStop ? 'End trip' : 'Done'}
            </button>
          </div>
        ) : (
          <div className="nav-bottom-row">
            <div className="nav-bottom-stats">
              <strong>{progress ? formatMinutes(progress.remainingSeconds) : '…'}</strong>
              <span>
                {progress ? `${formatDistance(progress.remainingMeters, units)} · arrive ${eta}` : ''}
              </span>
            </div>
            <button type="button" className="nav-round-btn" onClick={toggleMute} aria-label={muted ? 'Unmute voice' : 'Mute voice'}>
              {muted ? '\u{1F507}' : '\u{1F50A}'}
            </button>
            {!following && (
              <button type="button" className="nav-round-btn" onClick={onRecenter} aria-label="Recenter on me">
                {'\u{1F4CD}'}
              </button>
            )}
            <button type="button" className="btn btn-danger" onClick={onEnd}>
              End
            </button>
          </div>
        )}
      </div>
    </>
  );
}
