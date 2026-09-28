import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../lib/AuthContext';
import { usePairStreaks } from '../lib/PairStreakContext';
import { useBadges } from '../lib/BadgesContext';
import { subscribeDayEntries, PICKS_STREAK_THRESHOLD } from '../lib/pairStreaks';
import { dayKey } from '../lib/streaks';

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

export default function StreakPopup({ onClose }) {
  const { user } = useAuth();
  const { streaks, leaveStreak } = usePairStreaks();
  const [openId, setOpenId] = useState(streaks.length === 1 ? streaks[0].id : null);

  const selected = streaks.find((s) => s.id === openId) || null;

  const handleLeave = async (id) => {
    setOpenId(null);
    await leaveStreak(id);
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {selected ? (
          <StreakDetail
            streak={selected}
            onBack={streaks.length > 1 ? () => setOpenId(null) : null}
            onLeave={handleLeave}
          />
        ) : streaks.length === 0 ? (
          <>
            <h3 style={{ marginTop: 0 }}>{'\u{1F525}'} Streaks</h3>
            <p className="screen-subtitle" style={{ marginTop: 0 }}>
              Invite a friend to start one. Open Friends below, tap a friend, and choose "Start a Streak".
            </p>
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
