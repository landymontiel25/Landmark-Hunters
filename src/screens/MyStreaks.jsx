import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useGeo } from '../lib/GeoContext';
import { usePairStreaks } from '../lib/PairStreakContext';
import { listFriends } from '../lib/friends';
import {
  subscribeDayEntries,
  setStreakCity,
  submitCardRating,
  submitCardGuess,
  spendFreeze,
  completeRecoveryMission,
  computeCompatibility,
  MAX_ACTIVE_STREAKS,
  FREEZES_PER_MONTH,
} from '../lib/pairStreaks';
import { dailyDeck } from '../lib/sharedDeck';
import { pickRegion } from '../lib/tagScores';
import { getRegion, PICKABLE_REGIONS } from '../data/regions';
import { getUserCheckedInLandmarkIds } from '../lib/leaderboard';
import { dayKey, monthKey } from '../lib/streaks';
import { friendlyError } from '../lib/friendlyError';
import { SkeletonList } from '../components/Skeleton';

// Same verdict vocabulary Mapr Travel Picks uses (MaprPicksCarousel.jsx) --
// "would you go", not "how was it", since a shared card is often somewhere
// neither of you has actually been yet.
const VOTE_COPY = {
  yes: { cls: 'love', emoji: '\u{2713}', label: "I'd go" },
  unsure: { cls: 'unsure', emoji: '\u{1F937}', label: 'Not sure' },
  no: { cls: 'hate', emoji: '\u{2715}', label: 'Not for me' },
};

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

// One card in today's shared deck, in a Mapr Travel Picks-style swipeable
// carousel (.mapr-picks-track / .mapr-pick, MaprPicksCarousel.jsx). Rate
// first; the guess step only unlocks once you have (spec item 2, "the
// guess unlocks only after the user submits their own rating"). Once
// you've done both, the card is done for you -- like a Travel Picks vote,
// it leaves the row (StreakDetail filters it out); the reveal (both
// answers, whether your guess was right) shows in the "Today's results"
// list below the carousel instead of staying inline here.
// How long the "✓ vote registered" confirmation shows before this card
// advances (rate -> guess step) or, once both are in, leaves the carousel
// on its own (the parent re-render does that once myEntry catches up).
const VOTE_CONFIRM_MS = 700;

function DeckCard({ streak, landmark, myEntry, onGuessed }) {
  const navigate = useNavigate();
  const myRating = myEntry?.ratings?.[landmark.id];
  const [busy, setBusy] = useState(false);
  // The verdict just tapped, shown as a checkmark in place of the vote row
  // for a beat -- same "your tap registered" confirmation Mapr Travel
  // Picks gives, instead of the buttons silently swapping to the next
  // question the instant Firestore's write lands.
  const [justVoted, setJustVoted] = useState(null);

  const rate = async (verdict) => {
    setBusy(true);
    setJustVoted(verdict);
    try {
      await submitCardRating(streak.id, myEntry.uid, landmark.id, verdict);
    } finally {
      setBusy(false);
      setTimeout(() => setJustVoted(null), VOTE_CONFIRM_MS);
    }
  };
  const guess = async (verdict) => {
    setBusy(true);
    setJustVoted(verdict);
    try {
      await onGuessed(landmark.id, verdict);
    } finally {
      setBusy(false);
      setTimeout(() => setJustVoted(null), VOTE_CONFIRM_MS);
    }
  };

  return (
    <div className="mapr-pick">
      <button
        type="button"
        className="mapr-pick-main"
        onClick={() => navigate(`/landmarks/${landmark.regionId || streak.cityId}/${landmark.id}`)}
      >
        {landmark.images?.[0] ? (
          <img className="mapr-pick-img" src={landmark.images[0]} alt="" loading="lazy" />
        ) : (
          <div className="mapr-pick-img mapr-pick-img-blank">{'\u{1F4CD}'}</div>
        )}
        <span className="mapr-pick-name">{landmark.name}</span>
        <span className="mapr-pick-sub">{(landmark.summary || '').split(/(?<=[.!?])\s/)[0]}</span>
      </button>

      {justVoted ? (
        <div className="mapr-pick-actions">
          <span className="mapr-pick-vote-done">{'\u{2713}'} {VOTE_COPY[justVoted].label}</span>
        </div>
      ) : !myRating ? (
        <div className="mapr-pick-actions">
          {['no', 'unsure', 'yes'].map((verdict) => {
            const copy = VOTE_COPY[verdict];
            return (
              <button
                key={verdict}
                type="button"
                className={`mapr-pick-vote ${copy.cls}`}
                disabled={busy}
                onClick={() => rate(verdict)}
              >
                {copy.emoji} {copy.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{ padding: '10px 12px 0' }}>
          <p className="screen-subtitle" style={{ margin: '0 0 8px' }}>
            You said {VOTE_COPY[myRating].label}. What will your streak partner say?
          </p>
          <div className="mapr-pick-actions" style={{ padding: 0 }}>
            {['no', 'unsure', 'yes'].map((verdict) => {
              const copy = VOTE_COPY[verdict];
              return (
                <button
                  key={verdict}
                  type="button"
                  className={`mapr-pick-vote ${copy.cls}`}
                  disabled={busy}
                  onClick={() => guess(verdict)}
                >
                  {copy.emoji} {copy.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// One streak's full detail: who it's with, count/best, today's shared
// 3-card deck (rate then guess, per card, Mapr Travel Picks-style
// carousel), a live day-status per person, how long it's existed, shared
// freezes, a recovery mission banner when one's open, and a compatibility
// score once there's enough shared data. "Guess accuracy" (the spec's
// second stat under compatibility) isn't shown as a number yet -- but
// "Today's results" below the carousel is exactly that same signal, just
// not yet rolled up into one stat. Mapr picks the city and the landmarks;
// there's no manual city picker here (see the auto-pick effect below),
// matching how Mapr Travel Picks itself defaults to wherever you are.
function StreakDetail({ streak, onBack, onLeave }) {
  const { user } = useAuth();
  const { coords } = useGeo();
  const { closeToday } = usePairStreaks();
  const [entries, setEntries] = useState({});
  const [freezeBusy, setFreezeBusy] = useState(false);
  const [freezeMsg, setFreezeMsg] = useState(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMsg, setRecoveryMsg] = useState(null);
  const [compat, setCompat] = useState(undefined); // undefined = loading
  // Union of both members' REAL check-ins (not votes/ratings) -- the deck
  // skips anywhere either of you has actually been, since the point is
  // discovering places together, not rating somewhere you've already
  // visited. undefined while loading so the deck doesn't briefly show
  // (and let someone start rating) a place that turns out to be excluded.
  const [visitedIds, setVisitedIds] = useState(undefined);
  // Landmark ids that just got their guess in -- kept in the carousel a
  // beat longer than myEntry alone would (see DeckCard's own checkmark
  // state) so the card doesn't vanish out from under the confirmation
  // it's showing.
  const [justCompletedIds, setJustCompletedIds] = useState(() => new Set());

  const today = dayKey(new Date());
  useEffect(() => subscribeDayEntries(streak.id, today, setEntries, () => {}), [streak.id, today]);

  const partnerUid = (streak.memberIds || []).find((uid) => uid !== user.uid);
  const partnerName = streak.memberNames?.[partnerUid] || 'A traveler';

  useEffect(() => {
    setCompat(undefined);
    computeCompatibility(user.uid, partnerUid)
      .then(setCompat)
      .catch(() => setCompat(null));
  }, [user.uid, partnerUid]);

  useEffect(() => {
    if (!streak.cityId) return;
    setVisitedIds(undefined);
    Promise.all([getUserCheckedInLandmarkIds(user.uid), getUserCheckedInLandmarkIds(partnerUid)])
      .then(([mine, theirs]) => setVisitedIds(new Set([...mine, ...theirs])))
      .catch(() => setVisitedIds(new Set()));
  }, [user.uid, partnerUid, streak.cityId]);

  // Mapr picks the city, not the user -- same default-location logic Mapr
  // Travel Picks itself uses (tagScores.js's pickRegion), just with a
  // guaranteed fallback (rather than null) so a streak never gets stuck
  // with no city if location is off: worst case, the first pickable city.
  // Whichever member opens this first sets it for the pair (setStreakCity
  // is the one field either member can write, per firestore.rules); the
  // ref stops a duplicate write from a re-render before that first write
  // has landed and streak.cityId has caught up.
  const pickedCityRef = useRef(false);
  useEffect(() => {
    if (streak.cityId || pickedCityRef.current) return;
    const origin = coords ? { lat: coords.lat, lng: coords.lng } : null;
    const defaultRegionId = pickRegion({ origin, fallbackRegions: [PICKABLE_REGIONS[0]?.id] });
    if (!defaultRegionId) return;
    pickedCityRef.current = true;
    setStreakCity(streak.id, defaultRegionId).catch(() => {
      pickedCityRef.current = false;
    });
  }, [streak.id, streak.cityId, coords, pickedCityRef]);

  const myEntry = entries[user.uid] || { uid: user.uid, ratings: {}, guesses: {} };
  const partnerEntry = entries[partnerUid];
  const deck = streak.cityId && visitedIds ? dailyDeck(streak.id, today, streak.cityId, visitedIds) : [];
  const cardIds = deck.map((l) => l.id);
  // Once you've rated AND guessed a card, it's done for you -- same as a
  // Mapr Travel Picks vote, it leaves the carousel (the reveal moves to
  // "Today's results" below instead of staying inline on the card).
  // justCompletedIds holds it in the carousel a moment longer so its own
  // checkmark confirmation (see DeckCard) has time to actually show.
  const isDone = (l) => myEntry.ratings?.[l.id] && myEntry.guesses?.[l.id];
  const remainingDeck = deck.filter((l) => !isDone(l) || justCompletedIds.has(l.id));
  const doneDeck = deck.filter((l) => isDone(l) && !justCompletedIds.has(l.id));
  const myGuessedCount = cardIds.filter((id) => myEntry.guesses?.[id]).length;
  const partnerGuessedCount = cardIds.filter((id) => partnerEntry?.guesses?.[id]).length;
  const myDayDone = cardIds.length > 0 && myGuessedCount === cardIds.length;
  const region = streak.cityId ? getRegion(streak.cityId) : null;

  const handleGuessed = async (landmarkId, verdict) => {
    // Marked "just completed" before the write lands, in the same tick as
    // the click -- otherwise there's a render where entries already shows
    // it done but justCompletedIds hasn't caught up yet, so the card gets
    // filtered out of remainingDeck and DeckCard unmounts (losing its own
    // checkmark state) before this ever gets a chance to keep it around.
    setJustCompletedIds((cur) => new Set(cur).add(landmarkId));
    const done = await submitCardGuess(streak.id, user.uid, landmarkId, verdict, cardIds);
    setTimeout(() => {
      setJustCompletedIds((cur) => {
        const next = new Set(cur);
        next.delete(landmarkId);
        return next;
      });
    }, VOTE_CONFIRM_MS);
    if (done) closeToday(streak.id);
  };

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

      <p className="screen-subtitle" style={{ marginTop: 14, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Today's 3 shared landmarks</span>
        <span className="tag" style={{ fontSize: '0.68rem' }}>{region ? region.name : 'Finding your city…'}</span>
      </p>
      {!streak.cityId ? (
        <SkeletonList count={1} label="Finding your city" />
      ) : visitedIds === undefined ? (
        <SkeletonList count={3} label="Loading today's landmarks" />
      ) : (
        <>
          <p style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>
            You: {myGuessedCount}/{cardIds.length} rated + guessed{myDayDone ? ' ✓' : ''} · @{partnerName}:{' '}
            {partnerGuessedCount}/{cardIds.length} rated + guessed{partnerGuessedCount === cardIds.length ? ' ✓' : ''}
          </p>
          {remainingDeck.length > 0 ? (
            <div className="mapr-picks-track">
              {remainingDeck.map((landmark) => (
                <DeckCard key={landmark.id} streak={streak} landmark={landmark} myEntry={myEntry} onGuessed={handleGuessed} />
              ))}
            </div>
          ) : (
            <p className="screen-subtitle" style={{ margin: 0 }}>
              {'✓'} You've rated and guessed all 3 for today.
            </p>
          )}
          {doneDeck.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p className="screen-subtitle" style={{ margin: '0 0 6px' }}>
                Today's results
              </p>
              {doneDeck.map((landmark) => {
                const myRating = myEntry.ratings[landmark.id];
                const myGuess = myEntry.guesses[landmark.id];
                const partnerRating = partnerEntry?.ratings?.[landmark.id];
                return (
                  <p key={landmark.id} style={{ margin: '0 0 4px', fontSize: '0.82rem' }}>
                    <strong>{landmark.name}</strong> -- you: {VOTE_COPY[myRating].label}, your guess: {VOTE_COPY[myGuess].label}
                    {partnerRating ? (
                      <>
                        {' · '}@{partnerName}: {VOTE_COPY[partnerRating].label} --{' '}
                        {partnerRating === myGuess ? 'guessed right! \u{1F389}' : 'not quite'}
                      </>
                    ) : (
                      <> {' · '}waiting on @{partnerName}</>
                    )}
                  </p>
                );
              })}
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
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
        {since(streak.createdAt) || 'Just started'}. The day counts once you're both fully rated and guessed on all 3.
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
        "How well you know each other" (a rolled-up guess-accuracy number) isn't shown yet -- each card's reveal
        above already tells you right/wrong per landmark, just not summarized into one score.
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
