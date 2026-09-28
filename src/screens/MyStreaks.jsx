import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { usePairStreaks } from '../lib/PairStreakContext';
import { useBadges } from '../lib/BadgesContext';
import { listFriends } from '../lib/friends';
import {
  subscribeDayEntries,
  spendFreeze,
  completeRecoveryMission,
  computeCompatibility,
  PICKS_STREAK_THRESHOLD,
  MAX_ACTIVE_STREAKS,
  FREEZES_PER_MONTH,
} from '../lib/pairStreaks';
import { dayKey, monthKey } from '../lib/streaks';
import { friendlyError } from '../lib/friendlyError';
import { SkeletonList } from '../components/Skeleton';

function since(createdAt) {
  const ms = createdAt?.seconds ? createdAt.seconds * 1000 : createdAt?.toMillis?.();
  if (!ms) return null;
  const days = Math.max(0, Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000)));
  if (days === 0) return 'started today';
  if (days === 1) return 'going 1 day';
  return `going ${days} days`;
}

function fmtPct(score) {
  return `${Math.round(score * 100)}%`;
}

const COMPATIBILITY_MIN_SHARED_DISPLAY = 10;

// One streak's full detail: who it's with, count/best, a live day-status
// per person, how long it's existed, shared freezes, a recovery mission
// banner when one's open, and a compatibility score once there's enough
// shared data. "Guess accuracy" (the spec's second stat under
// compatibility) isn't shown -- there's no partner-guess feature yet to
// measure it from.
function StreakDetail({ streak, onBack, onLeave }) {
  const { user } = useAuth();
  const { actionsToday } = useBadges();
  const [entries, setEntries] = useState({});
  const [freezeBusy, setFreezeBusy] = useState(false);
  const [freezeMsg, setFreezeMsg] = useState(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMsg, setRecoveryMsg] = useState(null);
  const [compat, setCompat] = useState(undefined); // undefined = loading

  useEffect(() => {
    const today = dayKey(new Date());
    return subscribeDayEntries(streak.id, today, setEntries, () => {});
  }, [streak.id]);

  const partnerUid = (streak.memberIds || []).find((uid) => uid !== user.uid);
  const partnerName = streak.memberNames?.[partnerUid] || 'A traveler';

  useEffect(() => {
    setCompat(undefined);
    computeCompatibility(user.uid, partnerUid)
      .then(setCompat)
      .catch(() => setCompat(null));
  }, [user.uid, partnerUid]);

  const myEntry = entries[user.uid];
  const partnerEntry = entries[partnerUid];
  const myDone = myEntry?.done || actionsToday >= PICKS_STREAK_THRESHOLD;
  const myCount = Math.max(myEntry?.count || 0, actionsToday);

  const thisMonth = monthKey(new Date());
  const freezesLeft = streak.freezeMonth === thisMonth ? streak.freezesLeft ?? FREEZES_PER_MONTH : FREEZES_PER_MONTH;
  const recoveryOpen = streak.recoveryOpenUntil && Date.now() < streak.recoveryOpenUntil;

  const handleFreeze = async () => {
    setFreezeBusy(true);
    setFreezeMsg(null);
    try {
      const r = await spendFreeze(streak.id);
      setFreezeMsg(r.alreadyFrozen ? "Today's already frozen." : `Freeze used -- ${r.freezesLeft} left this month.`);
    } catch (e) {
      setFreezeMsg(friendlyError(e, "Couldn't use a freeze. Try again."));
    } finally {
      setFreezeBusy(false);
    }
  };

  const handleRecovery = async () => {
    setRecoveryBusy(true);
    setRecoveryMsg(null);
    try {
      const r = await completeRecoveryMission(streak.id);
      setRecoveryMsg(r.ok ? `Recovered! Back to a ${r.count}-day streak.` : r.error);
    } catch (e) {
      setRecoveryMsg(friendlyError(e, "Couldn't complete the recovery mission. Try again."));
    } finally {
      setRecoveryBusy(false);
    }
  };

  return (
    <div className="card section">
      <h3 style={{ marginTop: 0 }}>
        {'\u{1F525}'} You &amp; @{partnerName}
      </h3>
      <div className="profile-stats">
        <div className="profile-stat">
          <span className="profile-stat-num">{streak.count}</span>
          <span className="profile-stat-label">current</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-num">{streak.best}</span>
          <span className="profile-stat-label">best</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-num">{freezesLeft}</span>
          <span className="profile-stat-label">freezes left</span>
        </div>
      </div>

      {recoveryOpen && (
        <div style={{ marginTop: 14, padding: 10, borderRadius: 10, border: '1px solid var(--color-rust)' }}>
          <p style={{ margin: '0 0 6px', fontWeight: 700 }}>{'\u{1F6A8}'} Recovery Mission open</p>
          <p className="screen-subtitle" style={{ margin: '0 0 8px' }}>
            You broke the chain with no freezes left. Check in at the same landmark within 30 minutes of each other
            (or, long-distance, each check in anywhere) in the next 24 hours to get your {streak.recoveryPriorCount}-day
            streak back.
          </p>
          <button type="button" className="btn btn-primary btn-sm" disabled={recoveryBusy} onClick={handleRecovery}>
            {recoveryBusy ? '…' : "I've checked in -- try recovery"}
          </button>
          {recoveryMsg && (
            <p className="screen-subtitle" style={{ marginTop: 6, marginBottom: 0 }}>
              {recoveryMsg}
            </p>
          )}
        </div>
      )}

      <p className="screen-subtitle" style={{ marginTop: 14, marginBottom: 4 }}>
        Today's status
      </p>
      <p style={{ margin: '0 0 4px', fontSize: '0.9rem' }}>
        You: {myDone ? `✓ done (${myCount}/${PICKS_STREAK_THRESHOLD})` : `${myCount}/${PICKS_STREAK_THRESHOLD} rated today`}
      </p>
      <p style={{ margin: '0 0 10px', fontSize: '0.9rem' }}>
        @{partnerName}: {partnerEntry?.done ? `✓ done (${partnerEntry.count}/${PICKS_STREAK_THRESHOLD})` : `${partnerEntry?.count || 0}/${PICKS_STREAK_THRESHOLD} rated today`}
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={freezeBusy || freezesLeft <= 0} onClick={handleFreeze}>
          {freezeBusy ? '…' : `❄️ Use a Freeze (${freezesLeft} left)`}
        </button>
      </div>
      {freezeMsg && (
        <p className="screen-subtitle" style={{ marginTop: -6, marginBottom: 10 }}>
          {freezeMsg}
        </p>
      )}

      <p className="screen-subtitle" style={{ marginBottom: 0 }}>
        {since(streak.createdAt) || 'Just started'}. The day counts once you're both at {PICKS_STREAK_THRESHOLD} rated
        or voted in Mapr Travel Picks.
      </p>

      <p className="screen-subtitle" style={{ marginTop: 14, marginBottom: 4 }}>
        Compatibility
      </p>
      {compat === undefined ? (
        <p className="screen-subtitle" style={{ margin: 0 }}>
          Loading…
        </p>
      ) : compat === null ? (
        <p className="screen-subtitle" style={{ margin: 0 }}>
          Couldn't load a compatibility score right now.
        </p>
      ) : compat.score === null ? (
        <p className="screen-subtitle" style={{ margin: 0 }}>
          Rate {COMPATIBILITY_MIN_SHARED_DISPLAY - compat.sharedCount} more of the same places to unlock a
          compatibility score ({compat.sharedCount}/{COMPATIBILITY_MIN_SHARED_DISPLAY} shared so far).
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: '0.9rem' }}>
          {fmtPct(compat.score)} match across {compat.sharedCount} shared landmarks.
        </p>
      )}
      <p className="screen-subtitle" style={{ marginTop: 6, marginBottom: 0, fontSize: '0.72rem' }}>
        "How well you know each other" (guess accuracy) isn't shown yet -- it needs the "guess what your partner
        picked" step, which isn't built.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {onBack && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={onBack}>
            {'‹'} Back
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ flex: 1 }}
          onClick={() => window.confirm(`Leave this streak with @${partnerName}?`) && onLeave(streak.id)}
        >
          Leave streak
        </button>
      </div>
    </div>
  );
}

// Streak-first, friend-second: reached from the streak icon itself, not by
// finding a friend first. Lists your existing friends right here so
// starting one is a single flow, not a detour through the Friends section.
function StartStreakPicker({ existingPartnerUids, onStarted, onCancel }) {
  const { user } = useAuth();
  const { startStreakWith } = usePairStreaks();
  const [friends, setFriends] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busyUid, setBusyUid] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    listFriends(user.uid)
      .then(setFriends)
      .catch((e) => {
        setFriends([]);
        setLoadError(e);
      });
  }, [user.uid]);

  const pick = async (f) => {
    setBusyUid(f.friend);
    setErr(null);
    try {
      const s = await startStreakWith({ uid: f.friend, name: f.friendName });
      onStarted(s.id);
    } catch (e) {
      setErr(friendlyError(e, "Couldn't start a streak. Try again."));
    } finally {
      setBusyUid(null);
    }
  };

  const available = (friends || []).filter((f) => !existingPartnerUids.has(f.friend));

  return (
    <div className="card section">
      <h3 style={{ marginTop: 0 }}>{'\u{1F525}'} Start a Streak</h3>
      <p className="screen-subtitle" style={{ marginTop: 0 }}>
        Pick a friend -- streaks are friends-only for now.
      </p>
      {friends === null ? (
        <SkeletonList count={3} label="Loading your friends" />
      ) : loadError ? (
        <p className="screen-subtitle" style={{ margin: 0 }}>
          {friendlyError(loadError, "Couldn't load your friends.")}
        </p>
      ) : available.length === 0 ? (
        <p className="screen-subtitle" style={{ margin: 0 }}>
          {friends.length === 0
            ? 'No friends yet -- add one from Profile, then come back here.'
            : "You're already streaking with everyone you can right now."}
        </p>
      ) : (
        available.map((f) => (
          <button
            key={f.friend}
            type="button"
            className="friend-row"
            style={{ width: '100%', cursor: 'pointer' }}
            disabled={busyUid === f.friend}
            onClick={() => pick(f)}
          >
            <span style={{ fontWeight: 700 }}>@{f.friendName}</span>
            <span>{busyUid === f.friend ? '…' : '›'}</span>
          </button>
        ))
      )}
      {err && (
        <p className="screen-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
          {err}
        </p>
      )}
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 16 }} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

// Your Stats' "streak" tile used to open a modal; this is a real page
// instead, matching check-ins/cities (MyCheckins.jsx/MyCities.jsx).
export default function MyStreaks() {
  const navigate = useNavigate();
  const { user, firebaseEnabled } = useAuth();
  const { streaks, leaveStreak } = usePairStreaks();
  const [openId, setOpenId] = useState(null);
  const [picking, setPicking] = useState(false);

  if (!firebaseEnabled || !user) {
    return (
      <div>
        <p className="screen-subtitle">Sign in on Profile to see your streaks.</p>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => navigate('/profile')}>
          {'←'} Back to Profile
        </button>
      </div>
    );
  }

  const selected = streaks.find((s) => s.id === openId) || null;
  const existingPartnerUids = new Set(
    streaks.map((s) => (s.memberIds || []).find((uid) => uid !== user.uid)).filter(Boolean)
  );

  const handleLeave = async (id) => {
    setOpenId(null);
    await leaveStreak(id);
  };

  return (
    <div>
      <button
        type="button"
        className="btn btn-ghost btn-block"
        style={{ marginBottom: 24 }}
        onClick={() => (picking ? setPicking(false) : selected ? setOpenId(null) : navigate('/profile'))}
      >
        {'←'} Back {picking || selected ? '' : 'to Profile'}
      </button>
      <h1 className="screen-title">
        <span>{'\u{1F525}'}</span> Your Streaks
      </h1>

      {picking ? (
        <StartStreakPicker
          existingPartnerUids={existingPartnerUids}
          onStarted={(id) => {
            setPicking(false);
            setOpenId(id);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : selected ? (
        <StreakDetail streak={selected} onBack={streaks.length > 1 ? () => setOpenId(null) : null} onLeave={handleLeave} />
      ) : streaks.length === 0 ? (
        <div className="card section">
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            You don't have a streak yet.
          </p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setPicking(true)}>
            {'\u{1F525}'} Start a Streak
          </button>
        </div>
      ) : (
        <div className="card section">
          {streaks.map((s) => {
            const partnerUid = (s.memberIds || []).find((uid) => uid !== user.uid);
            const partnerName = s.memberNames?.[partnerUid] || 'A traveler';
            return (
              <div key={s.id} className="friend-row" style={{ gap: 8 }}>
                <button
                  type="button"
                  style={{ flex: 1, display: 'flex', justifyContent: 'space-between', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit' }}
                  onClick={() => setOpenId(s.id)}
                >
                  <span style={{ fontWeight: 700 }}>@{partnerName}</span>
                  <span>
                    {s.count} {'\u{1F525}'} {'›'}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-tight"
                  aria-label={`Stop the streak with @${partnerName}`}
                  onClick={() => window.confirm(`Stop the streak with @${partnerName}? This can't be undone.`) && handleLeave(s.id)}
                >
                  {'\u{1F5D1}\u{FE0F}'}
                </button>
              </div>
            );
          })}
          {streaks.length < MAX_ACTIVE_STREAKS && (
            <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setPicking(true)}>
              {'\u{1F525}'} Start Another Streak
            </button>
          )}
        </div>
      )}
    </div>
  );
}
