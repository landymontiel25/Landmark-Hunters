import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useBadges } from '../lib/BadgesContext';
import { levelProgress } from '../lib/level';
import ConfettiBurst from './ConfettiBurst';

const LEVEL_KEY_PREFIX = 'lh-last-level-';
const AUTO_DISMISS_MS = 3200;

// Global Duolingo-style popup for two moments: earning a new badge (shown
// from BadgesContext's justEarned queue -- one at a time, oldest first) and
// leveling up (detected here by comparing against the last level we've
// shown this account, remembered in localStorage so it survives reloads
// and never repeats for a level already celebrated). Badges take priority;
// once the queue drains, a pending level-up shows on the next render.
export default function CelebrationOverlay() {
  const { user } = useAuth();
  const { stats, justEarned, dismissJustEarned } = useBadges();
  const [levelUp, setLevelUp] = useState(null);

  useEffect(() => {
    // A failed stats read is zeros, not a real level 1: recording that as the
    // baseline would later celebrate the account's actual level as a level-up.
    if (!user || !stats || stats.failed) return;
    const key = `${LEVEL_KEY_PREFIX}${user.uid}`;
    const { level } = levelProgress(stats.totalPoints);
    // Storage can be blocked/full; this effect runs app-wide, so a throw
    // here would crash the whole app. Without storage, skip level-ups.
    try {
      const stored = Number(localStorage.getItem(key)) || 0;
      if (stored === 0) {
        // First time we've ever seen this account's level -- record a
        // baseline instead of celebrating whatever level they already were.
        localStorage.setItem(key, String(level));
        return;
      }
      if (level > stored) {
        localStorage.setItem(key, String(level));
        setLevelUp(level);
      }
    } catch {
      /* storage unavailable */
    }
  }, [user, stats]);

  const badge = justEarned[0] || null;

  useEffect(() => {
    if (!badge) return;
    const t = setTimeout(() => dismissJustEarned(badge.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badge?.id]);

  useEffect(() => {
    // Not while a badge popup is covering it, or the level-up would expire
    // unseen before the badge queue drains.
    if (!levelUp || badge) return;
    const t = setTimeout(() => setLevelUp(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [levelUp, badge]);

  if (badge) {
    return (
      <div className="modal-backdrop" onClick={() => dismissJustEarned(badge.id)}>
        {/* Keying on the badge id forces a fresh mount per badge, so the
            pop-in and confetti (both one-shot CSS animations) actually
            replay for every badge shown -- reusing the same DOM nodes
            across a queue of several would just leave them frozen at their
            first, already-finished state. */}
        <div className="celebration-enter" key={badge.id}>
          <div className="celebration-float">
            <ConfettiBurst />
            <p className="celebration-eyebrow">{'\u{1F3C5}'} Badge Earned</p>
            <span className="celebration-icon">{badge.icon}</span>
            <p className="celebration-title">{badge.label}</p>
            <p className="celebration-subtitle">{badge.description}</p>
          </div>
        </div>
      </div>
    );
  }

  if (levelUp) {
    return (
      <div className="modal-backdrop" onClick={() => setLevelUp(null)}>
        <div className="celebration-enter" key={levelUp}>
          <div className="celebration-float">
            <ConfettiBurst />
            <p className="celebration-eyebrow">Level Up</p>
            <span className="celebration-icon flame">{'\u{1F525}'}</span>
            <p className="celebration-title">Level {levelUp}</p>
            <p className="celebration-subtitle">Keep exploring to reach the next one.</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
