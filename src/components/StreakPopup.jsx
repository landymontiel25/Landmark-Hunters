import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../lib/AuthContext';
import { usePairStreaks } from '../lib/PairStreakContext';
import { useBadges } from '../lib/BadgesContext';
import { listFriends } from '../lib/friends';
import { subscribeDayEntries, PICKS_STREAK_THRESHOLD, MAX_ACTIVE_STREAKS } from '../lib/pairStreaks';
import { dayKey } from '../lib/streaks';
import { friendlyError } from '../lib/friendlyError';
import { SkeletonList } from './Skeleton';

function since(createdAt) {
  const ms = createdAt?.seconds ? createdAt.seconds * 1000 : createdAt?.toMillis?.();
  if (!ms) return null;
  const days = Math.max(0, Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000)));
  if (days === 0) return 'started today';
  if (days === 1) return 'going 1 day';
  return `going ${days} days`;
}

// One streak's full detail: who it's with, count/best, a live day-status
// per person, and how long it's existed. Deliberately smaller than the
// full spec's popup (item 8) -- no freezes/recovery/compatibility yet,
// since none of that is built (see PairStreakContext.jsx).
function StreakDetail({ streak, onBack, onLeave }) {
  const { user } = useAuth();
  const { actionsToday } = useBadges();
  const [entries, setEntries] = useState({});

  useEffect(() => {
    const today = dayKey(new Date());
    return subscribeDayEntries(streak.id, today, setEntries, () => {});
  }, [streak.id]);

  const partnerUid = (streak.memberIds || []).find((uid) => uid !== user.uid);
  const partnerName = streak.memberNames?.[partnerUid] || 'A traveler';
  const myEntry = entries[user.uid];
  const partnerEntry = entries[partnerUid];
  const myDone = myEntry?.done || actionsToday >= PICKS_STREAK_THRESHOLD;
  const myCount = Math.max(myEntry?.count || 0, actionsToday);

  return (
    <>
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
      </div>
      <p className="screen-subtitle" style={{ marginTop: 14, marginBottom: 4 }}>
        Today's status
      </p>
      <p style={{ margin: '0 0 4px', fontSize: '0.9rem' }}>
        You: {myDone ? `✓ done (${myCount}/${PICKS_STREAK_THRESHOLD})` : `${myCount}/${PICKS_STREAK_THRESHOLD} rated today`}
      </p>
      <p style={{ margin: '0 0 10px', fontSize: '0.9rem' }}>
        @{partnerName}: {partnerEntry?.done ? `✓ done (${partnerEntry.count}/${PICKS_STREAK_THRESHOLD})` : `${partnerEntry?.count || 0}/${PICKS_STREAK_THRESHOLD} rated today`}
      </p>
      <p className="screen-subtitle" style={{ marginBottom: 0 }}>
        {since(streak.createdAt) || 'Just started'}. The day counts once you're both at {PICKS_STREAK_THRESHOLD} rated
        or voted in Mapr Travel Picks.
      </p>
      <p className="screen-subtitle" style={{ marginTop: 10, marginBottom: 0, fontSize: '0.72rem' }}>
        Freezes, recovery, and a compatibility score are coming in a later update.
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
    </>
  );
}

// Streak-first, friend-second: this is reached by tapping the streak icon
// itself (the header flame or the "streak" tile in Your Stats), not by
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
    <>
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
    </>
  );
}

export default function StreakPopup({ onClose }) {
  const { user } = useAuth();
  const { streaks, leaveStreak } = usePairStreaks();
  const [openId, setOpenId] = useState(streaks.length === 1 ? streaks[0].id : null);
  const [picking, setPicking] = useState(false);

  const selected = streaks.find((s) => s.id === openId) || null;
  const existingPartnerUids = new Set(
    streaks.map((s) => (s.memberIds || []).find((uid) => uid !== user.uid)).filter(Boolean)
  );

  const handleLeave = async (id) => {
    setOpenId(null);
    await leaveStreak(id);
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
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
          <StreakDetail
            streak={selected}
            onBack={streaks.length > 1 ? () => setOpenId(null) : null}
            onLeave={handleLeave}
          />
        ) : streaks.length === 0 ? (
          <>
            <h3 style={{ marginTop: 0 }}>{'\u{1F525}'} Streaks</h3>
            <p className="screen-subtitle" style={{ marginTop: 0 }}>
              You don't have a streak yet.
            </p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => setPicking(true)}>
              {'\u{1F525}'} Start a Streak
            </button>
          </>
        ) : (
          <>
            <h3 style={{ marginTop: 0 }}>{'\u{1F525}'} Your Streaks</h3>
            {streaks.map((s) => {
              const partnerUid = (s.memberIds || []).find((uid) => uid !== user.uid);
              return (
                <button
                  key={s.id}
                  type="button"
                  className="friend-row"
                  style={{ width: '100%', cursor: 'pointer' }}
                  onClick={() => setOpenId(s.id)}
                >
                  <span style={{ fontWeight: 700 }}>@{s.memberNames?.[partnerUid] || 'A traveler'}</span>
                  <span>
                    {s.count} {'\u{1F525}'} {'›'}
                  </span>
                </button>
              );
            })}
            {streaks.length < MAX_ACTIVE_STREAKS && (
              <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setPicking(true)}>
                {'\u{1F525}'} Start Another Streak
              </button>
            )}
          </>
        )}
        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 16 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body
  );
}
