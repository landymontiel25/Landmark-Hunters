import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { subscribeMySoloStreak } from '../lib/soloStreaks';
import { msUntilStreakLapse, displayStreakCount, isDayHeld, PICKS_STREAK_THRESHOLD } from '../lib/streaks';
import { useTodayKey } from '../lib/useTodayKey';
import { notifyUser } from '../lib/notifications';

// Alert once 5 hours remain in the local day with the SOLO streak not yet
// secured today (lastCompletedDay isn't today -- the same server-authority
// signal Header's StreakBadge uses, so this banner and that badge can never
// disagree about whether today's frozen/secured/at risk) -- the same
// boundary the streak's own day-close counts by, so this is exactly when
// an active solo streak is about to actually lapse. Separate from (and
// doesn't touch) the dual streak's own per-pair countdown in the header.
const WARNING_WINDOW_MS = 5 * 60 * 60 * 1000;
const NOTIFIED_PREFIX = 'landmarkhunters.streakWarned.';

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// A persistent, app-wide (any screen) live countdown once your solo streak
// is close to lapsing -- "I had no idea" was the whole problem before this.
// Also fires one in-app notification the first time a session sees the
// threshold crossed. That notification is best-effort like everything
// else in lib/notifications.js: there's no server-side push here, so it
// only actually lands if someone has the app open sometime in that
// 5-hour window -- the live banner is what covers the rest of the time.
export default function StreakWarningBanner() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const today = useTodayKey();
  const [streak, setStreak] = useState(null);
  const [msLeft, setMsLeft] = useState(() => msUntilStreakLapse());

  useEffect(() => {
    if (!user) return undefined;
    return subscribeMySoloStreak(user.uid, setStreak, () => {});
  }, [user]);

  // 0 once the stored streak has already lapsed -- nothing left to warn about.
  const count = displayStreakCount(streak);
  // A freeze spent today holds the streak across today's gap, so it isn't
  // "about to lapse" any more -- don't nag someone who just used one.
  const secured = isDayHeld(streak, today);
  const atRisk = count > 0 && !secured;

  useEffect(() => {
    if (!atRisk) return;
    setMsLeft(msUntilStreakLapse());
    const id = setInterval(() => setMsLeft(msUntilStreakLapse()), 1000);
    return () => clearInterval(id);
  }, [atRisk]);

  const withinWarningWindow = atRisk && msLeft > 0 && msLeft <= WARNING_WINDOW_MS;

  useEffect(() => {
    if (!user || !withinWarningWindow) return;
    const key = `${NOTIFIED_PREFIX}${user.uid}.${today}`;
    try {
      if (localStorage.getItem(key) === '1') return;
      localStorage.setItem(key, '1');
    } catch {
      /* storage disabled -- skip the dedupe guard, worst case a repeat notification */
    }
    notifyUser(user.uid, {
      type: 'streak_warning',
      message: `\u{23F3} Your ${count}-day streak expires today — rate ${PICKS_STREAK_THRESHOLD} landmarks to keep it going!`,
    }).catch(() => {});
  }, [user, withinWarningWindow, count, today]);

  if (!withinWarningWindow) return null;

  return (
    <button
      type="button"
      // aria-live keeps the same "announce the ticking countdown" behavior
      // role="status" gave, but on a real, keyboard-focusable, Enter/Space-
      // activatable control instead of a plain div only a mouse could use.
      aria-live="polite"
      onClick={() => navigate('/streaks')}
      style={{
        display: 'block',
        width: '100%',
        border: 'none',
        font: 'inherit',
        background: 'var(--color-error, #b3503f)',
        color: '#fff',
        textAlign: 'center',
        fontSize: '0.82rem',
        fontWeight: 600,
        padding: '8px 12px',
        cursor: 'pointer',
      }}
    >
      {'\u{23F3}'} Your {count}-day streak expires in {formatCountdown(msLeft)} — rate {PICKS_STREAK_THRESHOLD} landmarks to keep it!
    </button>
  );
}
