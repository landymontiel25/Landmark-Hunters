import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useGeo } from '../lib/GeoContext';
import { useFriends } from '../lib/FriendsContext';
import { usePairStreaks } from '../lib/PairStreakContext';
import { listFriends } from '../lib/friends';
import {
  subscribeDayEntries,
  setStreakCity,
  submitCardRating,
  submitCardGuess,
  spendFreeze,
  resetDualStreak,
  completeRecoveryMission,
  computeCompatibility,
  MAX_ACTIVE_STREAKS,
  FREEZES_PER_MONTH,
} from '../lib/pairStreaks';
import {
  ensureSoloStreak,
  subscribeMySoloStreak,
  setSoloStreakCity,
  submitSoloCardRating,
  subscribeSoloDayEntry,
  closeSoloToday,
  spendSoloFreeze,
  SOLO_FREEZES_PER_MONTH,
} from '../lib/soloStreaks';
import { dailyDeck } from '../lib/sharedDeck';
import MaprPicksCarousel from '../components/MaprPicksCarousel';
import { nearestPickableCity } from '../lib/nearestCity';
import { usePickVotes } from '../lib/usePickVotes';
import { useRatings } from '../lib/RatingsContext';
import { pickRegion } from '../lib/tagScores';
import { getRegion, PICKABLE_REGIONS } from '../data/regions';
import { getUserCheckedInLandmarkIds } from '../lib/leaderboard';
import { monthKey, displayStreakCount } from '../lib/streaks';
import { useTodayKey } from '../lib/useTodayKey';
import { friendlyError } from '../lib/friendlyError';
import { useToast } from '../lib/ToastContext';
import { SkeletonList } from '../components/Skeleton';
import MaprPickImage from '../components/MaprPickImage';

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
// carousel (.mapr-picks-track / .mapr-pick, MaprPicksCarousel.jsx). Used
// for both phases (rate, then guess -- see StreakDetail). Voting on a card
// removes it from the row immediately -- exactly like a Mapr Travel Picks
// vote, no checkmark stage, it just disappears -- because the parent
// filters it out of what it renders the instant the optimistic write
// overlay is set (StreakDetail's shownRating/shownGuess), before the
// Firestore write itself even lands. If the write actually fails, the
// optimistic overlay gets cleared and the card reappears on its own
// (there's no card left to show an inline error on at that point -- see
// StreakDetail's voteError banner instead).
function VoteCard({ streak, landmark, prompt, onVote, onError }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const vote = async (verdict) => {
    setBusy(true);
    try {
      await onVote(landmark.id, verdict);
    } catch (e) {
      // eslint-disable-next-line no-console -- worth having in the device
      // console if someone needs to debug a save that silently didn't work.
      console.error('Vote failed to save', landmark.id, verdict, e);
      onError(friendlyError(e, `Couldn't save your vote for ${landmark.name} -- try again.`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mapr-pick">
      <button
        type="button"
        className="mapr-pick-main"
        onClick={() => navigate(`/landmarks/${landmark.regionId || streak.cityId}/${landmark.id}`)}
      >
        <MaprPickImage landmark={landmark} />
        <span className="mapr-pick-name">{landmark.name}</span>
        <span className="mapr-pick-sub">{(landmark.summary || '').split(/(?<=[.!?])\s/)[0]}</span>
      </button>

      {prompt && (
        <p className="screen-subtitle" style={{ margin: '0 0 8px', padding: '10px 12px 0' }}>
          {prompt}
        </p>
      )}
      <div className="mapr-pick-actions" style={prompt ? { padding: '0 12px' } : undefined}>
        {['no', 'unsure', 'yes'].map((verdict) => {
          const copy = VOTE_COPY[verdict];
          return (
            <button
              key={verdict}
              type="button"
              className={`mapr-pick-vote ${copy.cls}`}
              disabled={busy}
              onClick={() => vote(verdict)}
            >
              {copy.emoji} {copy.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// One streak's full detail: who it's with, count/best, today's shared
// 3-card deck, a live day-status per person, how long it's existed, shared
// freezes, a recovery mission banner when one's open, and a compatibility
// score once there's enough shared data. The deck is two full phases, not
// per-card rate-then-guess: rate all 3 first (each one turns into a
// checkmark on the same card, in place, as you go), then once all 3 are
// in, the same 3 cards switch to the guess question ("what will your
// partner pick?"). "Guess accuracy" (the spec's second stat under
// compatibility) isn't shown as a number yet -- but "Today's results"
// below the carousel is exactly that same signal, just not yet rolled up
// into one stat. Mapr picks the city and the landmarks; there's no manual
// city picker here (see the auto-pick effect below), matching how Mapr
// Travel Picks itself defaults to wherever you are.
function StreakDetail({ streak, onBack, onLeave }) {
  const { user } = useAuth();
  const { coords } = useGeo();
  const { closeToday } = usePairStreaks();
  const [entries, setEntries] = useState({});
  const [freezeBusy, setFreezeBusy] = useState(false);
  const [freezeMsg, setFreezeMsg] = useState(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMsg, setRecoveryMsg] = useState(null);
  // TEMPORARY: a one-off correction, not a normal capability -- see
  // api/reset-dual-streak.js's own note. Safe to remove once used.
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState(null);
  const [compat, setCompat] = useState(undefined); // undefined = loading
  // Union of both members' REAL check-ins (not votes/ratings) -- the deck
  // skips anywhere either of you has actually been, since the point is
  // discovering places together, not rating somewhere you've already
  // visited. undefined while loading so the deck doesn't briefly show
  // (and let someone start rating) a place that turns out to be excluded.
  const [visitedIds, setVisitedIds] = useState(undefined);
  // Optimistic overlays: set the instant a vote is tapped, before the
  // Firestore write lands, so the card's checkmark shows immediately and
  // never has to wait on (or get reset by) round-trip timing. Cleared on a
  // failed write (with the error shown on the card) or when the day rolls
  // over; otherwise just gets superseded by the real synced value once it
  // arrives, with no visible change either way.
  const [optimisticRatings, setOptimisticRatings] = useState({});
  const [optimisticGuesses, setOptimisticGuesses] = useState({});
  // Set if today's entries listener itself fails (e.g. a dropped auth
  // token, a network blip that Firestore's SDK doesn't silently recover
  // from) -- shown loud rather than swallowed, since a vote can genuinely
  // have saved while this stays stuck showing stale/empty state, which
  // otherwise looks exactly like "nothing was saved" on the next reload.
  const [entriesError, setEntriesError] = useState(null);
  // A vote failing to save has no card left to show an inline error on --
  // it's already gone from the row (see VoteCard's note) -- so it lands
  // here instead, above the deck.
  const [voteError, setVoteError] = useState(null);

  const today = useTodayKey();
  useEffect(() => {
    // Reset here, in the same effect that (re)subscribes, rather than a
    // separate effect with the same deps -- a separate one would run right
    // after this one on every mount and wipe out an error/overlay this
    // effect's own onError just set, since both fire in the same commit.
    setOptimisticRatings({});
    setOptimisticGuesses({});
    setEntriesError(null);
    return subscribeDayEntries(streak.id, today, setEntries, (e) => {
      // eslint-disable-next-line no-console -- worth having in the device
      // console if someone needs to debug why today's ratings aren't showing.
      console.error("Today's streak entries failed to load", e);
      setEntriesError(friendlyError(e, "Couldn't load today's ratings."));
    });
  }, [streak.id, today]);

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
  // Whether a card's already been voted on -- the optimistic tap if
  // there's one still in flight, else whatever's actually synced. Used to
  // filter it OUT of what renders (see remainingToRate/remainingToGuess
  // below), not to show a checkmark on it -- a voted card just disappears,
  // exactly like a Mapr Travel Picks vote.
  const shownRating = (id) => optimisticRatings[id] ?? myEntry.ratings?.[id];
  const shownGuess = (id) => optimisticGuesses[id] ?? myEntry.guesses?.[id];
  const remainingToRate = deck.filter((l) => !shownRating(l.id));
  const remainingToGuess = deck.filter((l) => !shownGuess(l.id));
  // Phase transitions (rate all 3 -> guess all 3 -> done) key off the real
  // synced counts, not the optimistic ones -- a card disappears from its
  // row instantly on tap, but the deck only moves to the next phase once
  // Firestore actually confirms all 3, so "Today's results" is never built
  // from a guess that hasn't landed yet.
  const myGuessedCount = cardIds.filter((id) => myEntry.guesses?.[id]).length;
  const myRatedCount = cardIds.filter((id) => myEntry.ratings?.[id]).length;
  const partnerGuessedCount = cardIds.filter((id) => partnerEntry?.guesses?.[id]).length;
  const ratingPhaseDone = cardIds.length > 0 && myRatedCount === cardIds.length;
  const myDayDone = cardIds.length > 0 && myGuessedCount === cardIds.length;
  const region = streak.cityId ? getRegion(streak.cityId) : null;

  // The close call is fire-and-forget right after a vote, so a dropped
  // request (or the partner finishing last while this screen isn't open)
  // would leave a fully-rated day never counted. Re-ping once whenever both
  // halves are in but the server hasn't closed today yet.
  const closeRetriedFor = useRef(null);
  const bothDone = myDayDone && cardIds.length > 0 && partnerGuessedCount === cardIds.length;
  useEffect(() => {
    if (!bothDone || streak.lastCompletedDay === today || closeRetriedFor.current === today) return;
    closeRetriedFor.current = today;
    closeToday(streak.id);
  }, [bothDone, streak.lastCompletedDay, streak.id, today, closeToday]);

  const handleRate = async (landmarkId, verdict) => {
    setVoteError(null);
    setOptimisticRatings((cur) => ({ ...cur, [landmarkId]: verdict }));
    try {
      await submitCardRating(streak.id, user.uid, landmarkId, verdict);
    } catch (e) {
      setOptimisticRatings((cur) => {
        const next = { ...cur };
        delete next[landmarkId];
        return next;
      });
      throw e;
    }
  };

  const handleGuess = async (landmarkId, verdict) => {
    setVoteError(null);
    setOptimisticGuesses((cur) => ({ ...cur, [landmarkId]: verdict }));
    try {
      const done = await submitCardGuess(streak.id, user.uid, landmarkId, verdict, cardIds);
      if (done) closeToday(streak.id);
    } catch (e) {
      setOptimisticGuesses((cur) => {
        const next = { ...cur };
        delete next[landmarkId];
        return next;
      });
      throw e;
    }
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

  const handleReset = async () => {
    const typed = window.prompt(
      `Reset the current streak with @${partnerName} to 0? This can't be undone (your best streak is kept). Type RESET to confirm.`
    );
    if (typed?.trim().toUpperCase() !== 'RESET') return;
    setResetBusy(true);
    setResetMsg(null);
    try {
      await resetDualStreak(streak.id, 'RESET');
      setResetMsg('Reset to 0.');
    } catch (e) {
      setResetMsg(friendlyError(e, "Couldn't reset that streak. Try again."));
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="card section">
      <h3 style={{ marginTop: 0 }}>
        {'\u{1F525}'} You &amp; @{partnerName}
      </h3>
      <div className="profile-stats">
        <div className="profile-stat">
          <span className="profile-stat-num">{displayStreakCount(streak)}</span>
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
      {entriesError && <p className="mapr-pick-error" style={{ margin: '0 0 10px' }}>{'\u{26A0}\u{FE0F}'} {entriesError}</p>}
      {voteError && <p className="mapr-pick-error" style={{ margin: '0 0 10px' }}>{'\u{26A0}\u{FE0F}'} {voteError}</p>}
      {!streak.cityId ? (
        <SkeletonList count={1} label="Finding your city" />
      ) : visitedIds === undefined ? (
        <SkeletonList count={3} label="Loading today's landmarks" />
      ) : cardIds.length === 0 ? (
        <p className="screen-subtitle" style={{ margin: 0 }}>
          No landmarks left to rate here today.
        </p>
      ) : !ratingPhaseDone ? (
        <>
          <p style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>
            Rate today's 3 ({myRatedCount}/{cardIds.length}) -- once all 3 are in, you'll guess what @{partnerName}{' '}
            picks, to build your compatibility score.
          </p>
          <div className="mapr-picks-track">
            {remainingToRate.map((landmark) => (
              <VoteCard key={landmark.id} streak={streak} landmark={landmark} onVote={handleRate} onError={setVoteError} />
            ))}
          </div>
        </>
      ) : !myDayDone ? (
        <>
          {/* A deliberately big, colorful, animated moment -- so this doesn't
              read as the same 3 cards repeating the same question (the
              complaint that led to this), but as a clearly new step. */}
          <div className="streak-guess-banner">
            <span className="streak-guess-banner-icon">{'\u{1F52E}'}</span>
            <p className="streak-guess-banner-title">Your turn to guess!</p>
            <p className="streak-guess-banner-sub">
              What will @{partnerName} say about each one? ({myGuessedCount}/{cardIds.length}) -- get it right to
              build your compatibility score.
            </p>
          </div>
          <div className="mapr-picks-track streak-guess-track">
            {remainingToGuess.map((landmark) => (
              <VoteCard
                key={landmark.id}
                streak={streak}
                landmark={landmark}
                prompt={`What will @${partnerName} say about this one?`}
                onVote={handleGuess}
                onError={setVoteError}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="screen-subtitle" style={{ margin: '0 0 4px' }}>
            {'✓'} You've rated and guessed all 3 for today. @{partnerName}:{' '}
            {partnerGuessedCount}/{cardIds.length} rated + guessed{partnerGuessedCount === cardIds.length ? ' ✓' : ''}
          </p>
          <div style={{ marginTop: 10 }}>
            <p className="screen-subtitle" style={{ margin: '0 0 6px' }}>
              Today's results
            </p>
            {deck.map((landmark) => {
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

      {/* TEMPORARY: a one-off correction, not a normal capability -- see
          api/reset-dual-streak.js's own note. Safe to remove once used. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={resetBusy} onClick={handleReset}>
          {resetBusy ? '…' : '↺ Reset to 0'}
        </button>
      </div>
      {resetMsg && (
        <p className="screen-subtitle" style={{ marginTop: -6, marginBottom: 10 }}>
          {resetMsg}
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

// A solo streak's own detail: rate today's 3 (the same deterministic
// per-day-3 mechanism dual streaks use, just seeded with your own uid
// instead of a pairId), and the count goes up. No partner, so none of
// StreakDetail's guess step, shared-freeze accounting, recovery mission,
// or reveal apply here -- rating all 3 just closes the day outright. One
// personal freeze a month instead of two shared ones. A banner at the
// bottom offers to start a real dual streak with a friend -- that's a
// BRAND NEW streak at 0 (the same StartStreakPicker flow as "Start a
// Streak" on the list below); this streak's own count is never touched by
// that.
function SoloStreakDetail({ streak, onBack, onInvite }) {
  const { user } = useAuth();
  const { coords } = useGeo();
  const [entry, setEntry] = useState({ uid: user.uid, ratings: {} });
  const [freezeBusy, setFreezeBusy] = useState(false);
  const [freezeMsg, setFreezeMsg] = useState(null);
  const [visitedIds, setVisitedIds] = useState(undefined);
  const [optimisticRatings, setOptimisticRatings] = useState({});
  const [entriesError, setEntriesError] = useState(null);
  const [voteError, setVoteError] = useState(null);
  const [closeMsg, setCloseMsg] = useState(null);
  // Every answer on today's cards also teaches Mapr (pickVotes), like any
  // pick answer. Past the 3, the Travel Picks carousel for the city you are
  // in takes over, so you can rate as many more as you like.
  const { myReviews } = useRatings();
  const pickVotes = usePickVotes({ uid: user.uid, origin: coords ? { lat: coords.lat, lng: coords.lng } : null, removeOnAnyVote: true });
  const teachMapr = (landmark, verdict) => {
    if (!landmark) return;
    pickVotes
      .vote(
        { id: landmark.id, region: landmark.regionId || streak.cityId, name: landmark.name, categories: landmark.categories || [] },
        verdict,
        { requestFor: 'solo' }
      )
      .catch(() => {});
  };

  const today = useTodayKey();
  useEffect(() => {
    setOptimisticRatings({});
    setEntriesError(null);
    return subscribeSoloDayEntry(streak.id, today, setEntry, (e) => {
      // eslint-disable-next-line no-console -- worth having in the device
      // console if someone needs to debug why today's ratings aren't showing.
      console.error("Today's solo streak entry failed to load", e);
      setEntriesError(friendlyError(e, "Couldn't load today's ratings."));
    });
  }, [streak.id, today]);

  useEffect(() => {
    setVisitedIds(undefined);
    getUserCheckedInLandmarkIds(user.uid)
      .then((mine) => setVisitedIds(new Set(mine)))
      .catch(() => setVisitedIds(new Set()));
  }, [user.uid]);

  // Same auto-pick-the-city logic as StreakDetail/Mapr Travel Picks -- see
  // that component's own note.
  const pickedCityRef = useRef(false);
  useEffect(() => {
    if (streak.cityId || pickedCityRef.current) return;
    const origin = coords ? { lat: coords.lat, lng: coords.lng } : null;
    const defaultRegionId = pickRegion({ origin, fallbackRegions: [PICKABLE_REGIONS[0]?.id] });
    if (!defaultRegionId) return;
    pickedCityRef.current = true;
    setSoloStreakCity(streak.id, defaultRegionId).catch(() => {
      pickedCityRef.current = false;
    });
  }, [streak.id, streak.cityId, coords]);

  const deck = streak.cityId && visitedIds ? dailyDeck(streak.id, today, streak.cityId, visitedIds) : [];
  const cardIds = deck.map((l) => l.id);
  const shownRating = (id) => optimisticRatings[id] ?? entry.ratings?.[id];
  const remainingToRate = deck.filter((l) => !shownRating(l.id));
  const myRatedCount = cardIds.filter((id) => entry.ratings?.[id]).length;
  // The server's word wins: a day it already closed is done even if today's
  // cards changed after the ratings went in.
  const dayDone = streak.lastCompletedDay === today || (cardIds.length > 0 && myRatedCount === cardIds.length);
  const region = streak.cityId ? getRegion(streak.cityId) : null;

  // The city you are in right now (GPS), else the streak's own city.
  // Only needed once the day is done (the carousel), and only when the fix
  // moves ~1 km: this scans every landmark, so not on each GPS tick.
  const hereLat = coords ? Math.round(coords.lat * 100) / 100 : null;
  const hereLng = coords ? Math.round(coords.lng * 100) / 100 : null;
  const hereCity = useMemo(
    () => (dayDone && hereLat != null ? nearestPickableCity({ lat: hereLat, lng: hereLng }, 30) : null) || streak.cityId,
    [dayDone, hereLat, hereLng, streak.cityId]
  );
  // Stable carousel props, so it doesn't re-rank on every render.
  const pickReviews = useMemo(() => Object.values(myReviews || {}), [myReviews]);
  const pickCheckedInIds = useMemo(() => [...(visitedIds || [])], [visitedIds]);

  // If the close call right after the last rating failed (a network blip --
  // it's also what used to throw the rating back out of the optimistic
  // overlay), the day would stay "rated all 3" but never count. Re-ping once
  // whenever all 3 are in and the server hasn't closed today.
  const closeRetriedFor = useRef(null);
  const [closeRetryTick, setCloseRetryTick] = useState(0);
  useEffect(() => {
    if (!dayDone || streak.lastCompletedDay === today || closeRetriedFor.current === today) return;
    closeRetriedFor.current = today;
    closeSoloToday()
      .then((res) => {
        if (!res?.ok) closeRetriedFor.current = null;
      })
      .catch(() => {
        closeRetriedFor.current = null;
      });
  }, [dayDone, streak.lastCompletedDay, today, closeRetryTick]);

  const handleRate = async (landmarkId, verdict) => {
    setVoteError(null);
    setCloseMsg(null);
    setOptimisticRatings((cur) => ({ ...cur, [landmarkId]: verdict }));
    const willBeDone = cardIds.every((id) => id === landmarkId || entry.ratings?.[id]);
    // Claimed BEFORE the write: the local snapshot can flip dayDone (and fire the
    // retry effect above) before the awaited write even resolves, which would
    // send a second close and swallow the "+20 pts" result of this one.
    if (willBeDone) closeRetriedFor.current = today;
    try {
      await submitSoloCardRating(streak.id, landmarkId, verdict);
      teachMapr(deck.find((l) => l.id === landmarkId), verdict);
      if (willBeDone) {
        // The rating itself already saved -- a failed close ping must not throw it
        // back out of the optimistic overlay; the effect above retries it.
        const r = await closeSoloToday().catch(() => null);
        if (!r?.ok) {
          closeRetriedFor.current = null;
          setCloseRetryTick((n) => n + 1);
        }
        if (r?.closed && !r.already && r.pointsAwarded) {
          setCloseMsg(
            r.milestoneAwarded
              ? `+${r.pointsAwarded + r.milestoneAwarded} pts -- ${r.count}-day milestone!`
              : `+${r.pointsAwarded} pts -- today's secured.`
          );
        }
      }
    } catch (e) {
      if (willBeDone) closeRetriedFor.current = null;
      setOptimisticRatings((cur) => {
        const next = { ...cur };
        delete next[landmarkId];
        return next;
      });
      throw e;
    }
  };

  const thisMonth = monthKey(new Date());
  const freezesLeft =
    streak.freezeMonth === thisMonth ? streak.freezesLeft ?? SOLO_FREEZES_PER_MONTH : SOLO_FREEZES_PER_MONTH;

  const handleFreeze = async () => {
    setFreezeBusy(true);
    setFreezeMsg(null);
    try {
      const r = await spendSoloFreeze();
      setFreezeMsg(r.alreadyFrozen ? "Today's already frozen." : `Freeze used -- ${r.freezesLeft} left this month.`);
    } catch (e) {
      setFreezeMsg(friendlyError(e, "Couldn't use a freeze. Try again."));
    } finally {
      setFreezeBusy(false);
    }
  };

  return (
    <div className="card section">
      <h3 style={{ marginTop: 0 }}>{'\u{1F525}'} Your Solo Streak</h3>
      <div className="profile-stats">
        <div className="profile-stat">
          <span className="profile-stat-num">{displayStreakCount(streak)}</span>
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

      <p className="screen-subtitle" style={{ marginTop: 14, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Today's 3 landmarks</span>
        <span className="tag" style={{ fontSize: '0.68rem' }}>{region ? region.name : 'Finding your city…'}</span>
      </p>
      {entriesError && <p className="mapr-pick-error" style={{ margin: '0 0 10px' }}>{'\u{26A0}\u{FE0F}'} {entriesError}</p>}
      {voteError && <p className="mapr-pick-error" style={{ margin: '0 0 10px' }}>{'\u{26A0}\u{FE0F}'} {voteError}</p>}
      {!streak.cityId ? (
        <SkeletonList count={1} label="Finding your city" />
      ) : visitedIds === undefined ? (
        <SkeletonList count={3} label="Loading today's landmarks" />
      ) : cardIds.length === 0 ? (
        <p className="screen-subtitle" style={{ margin: 0 }}>
          No landmarks left to rate here today.
        </p>
      ) : !dayDone ? (
        <>
          <p style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>
            Rate today's 3 ({myRatedCount}/{cardIds.length}) to keep your streak going.
          </p>
          <div className="mapr-picks-track">
            {remainingToRate.map((landmark) => (
              <VoteCard key={landmark.id} streak={streak} landmark={landmark} onVote={handleRate} onError={setVoteError} />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="screen-subtitle" style={{ margin: 0 }}>
            {'✓'} You've rated all 3 today.{closeMsg ? ` ${closeMsg}` : ''} Keep going: every place you rate teaches Mapr more.
          </p>
          <div style={{ marginTop: 12 }}>
            <MaprPicksCarousel
              reviews={pickReviews}
              checkedInIds={pickCheckedInIds}
              homeCityId={hereCity}
              scope="streak"
            />
          </div>
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
        {since(streak.createdAt) || 'Just started'}. The day counts once you've rated 3; rate as many more as you like.
      </p>

      <div style={{ marginTop: 16, padding: 12, borderRadius: 10, border: '1px dashed var(--border-default)' }}>
        <p style={{ margin: '0 0 8px', fontWeight: 700 }}>{'\u{1F465}'} Add a friend to turn this into a dual streak.</p>
        <p className="screen-subtitle" style={{ margin: '0 0 10px' }}>
          A dual streak is its own thing -- rate and guess together, shared freezes, a compatibility score. It starts
          fresh at 0; this solo streak keeps going exactly as it is.
        </p>
        <button type="button" className="btn btn-ghost btn-block" onClick={onInvite}>
          {'\u{1F525}\u{1F525}'} Start a Dual Streak
        </button>
      </div>

      {onBack && (
        <button type="button" className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 16 }} onClick={onBack}>
          {'‹'} Back
        </button>
      )}
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

// Your Stats' combined "Streaks" tile lands here -- one real page, not a
// modal (matching check-ins/cities: MyCheckins.jsx/MyCities.jsx), with the
// two streak types kept apart as subtabs (Solo / Dual) rather than mixed
// into one list -- they're different enough (no partner/guess step, its
// own single freeze, its own rules) that browsing them side by side read as
// more confusing than useful, and it's what made a solo streak look like it
// belonged in the dual list in the first place (a real bug -- see
// pairStreaks.js's subscribeMyStreaks). Solo shows directly under its own
// tab (there's only ever one); Dual keeps a list, since a pair can have up
// to MAX_ACTIVE_STREAKS going at once.
export default function MyStreaks() {
  const navigate = useNavigate();
  const { user, firebaseEnabled } = useAuth();
  const { myUsername } = useFriends();
  const { streaks: storedStreaks, leaveStreak } = usePairStreaks();
  const toast = useToast();
  // A streak doc keeps the partner's handle from the day it was created; a
  // partner who has renamed since would keep showing under the old one.
  // Friends carry their live username (listFriends), so prefer that.
  const [liveNames, setLiveNames] = useState({});
  useEffect(() => {
    if (!firebaseEnabled || !user?.uid) return undefined;
    let cancelled = false;
    listFriends(user.uid)
      .then((fs) => !cancelled && setLiveNames(Object.fromEntries((fs || []).map((f) => [f.friend, f.friendName]))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [firebaseEnabled, user?.uid]);
  const streaks = storedStreaks.map((s) => {
    const live = (s.memberIds || []).filter((uid) => liveNames[uid]);
    return live.length ? { ...s, memberNames: { ...s.memberNames, ...Object.fromEntries(live.map((uid) => [uid, liveNames[uid]])) } } : s;
  });
  const [tab, setTab] = useState('solo');
  const [openDualId, setOpenDualId] = useState(null);
  const [picking, setPicking] = useState(false);
  const [soloStreak, setSoloStreak] = useState(null);
  const [soloError, setSoloError] = useState(null);

  // Created (and, for anyone with a pre-existing streak, seeded from real
  // history rather than reset to 0) the first time this screen loads for
  // this account -- see api/ensure-solo-streak.js's own note. Idempotent:
  // an existing doc is just returned and then kept live via the
  // subscription below.
  useEffect(() => {
    if (!firebaseEnabled || !user) return undefined;
    let cancelled = false;
    // The unsubscribe has to be kept: returning it from the .then() below
    // hands it to nobody, so every visit to this screen left a live
    // Firestore listener behind.
    let unsubscribe = null;
    const subscribe = () => {
      if (cancelled || unsubscribe) return;
      unsubscribe = subscribeMySoloStreak(user.uid, setSoloStreak, (e) => {
        // eslint-disable-next-line no-console
        console.error('Solo streak failed to load', e);
        if (!cancelled) setSoloError(friendlyError(e, "Couldn't load your solo streak."));
      });
    };
    ensureSoloStreak(myUsername || user.displayName || 'A traveler', user.uid)
      .then(subscribe)
      .catch((e) => {
        if (cancelled) return;
        setSoloError(friendlyError(e, "Couldn't load your solo streak."));
        // The set-up call failing (offline, server hiccup) doesn't mean the
        // streak doesn't exist -- an existing one can still be shown.
        subscribe();
      });
    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per account, not on every myUsername change
  }, [firebaseEnabled, user?.uid]);

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

  const dualSelected = streaks.find((s) => s.id === openDualId) || null;
  const existingPartnerUids = new Set(
    streaks.map((s) => (s.memberIds || []).find((uid) => uid !== user.uid)).filter(Boolean)
  );
  const inSubScreen = picking || !!dualSelected;

  const handleLeave = async (id) => {
    setOpenDualId(null);
    try {
      await leaveStreak(id);
    } catch (e) {
      toast?.show(friendlyError(e, "Couldn't leave the streak. Try again."));
    }
  };

  return (
    <div>
      <button
        type="button"
        className="btn btn-ghost btn-block"
        style={{ marginBottom: 24 }}
        onClick={() => (picking ? setPicking(false) : dualSelected ? setOpenDualId(null) : navigate('/profile'))}
      >
        {'←'} Back {inSubScreen ? '' : 'to Profile'}
      </button>
      <h1 className="screen-title">
        <span>{'\u{1F525}'}</span> Streaks
      </h1>

      {!inSubScreen && (
        <div className="tabs" style={{ margin: '0 0 16px' }}>
          <button type="button" className={`tab-btn ${tab === 'solo' ? 'active' : ''}`} aria-pressed={!!(tab === 'solo')} onClick={() => setTab('solo')}>
            {'\u{1F525}'} Solo
          </button>
          <button type="button" className={`tab-btn ${tab === 'dual' ? 'active' : ''}`} aria-pressed={!!(tab === 'dual')} onClick={() => setTab('dual')}>
            {'\u{1F525}\u{1F525}'} Dual
          </button>
        </div>
      )}

      {picking ? (
        <StartStreakPicker
          existingPartnerUids={existingPartnerUids}
          onStarted={(id) => {
            setPicking(false);
            setTab('dual');
            setOpenDualId(id);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : dualSelected ? (
        <StreakDetail streak={dualSelected} onBack={() => setOpenDualId(null)} onLeave={handleLeave} />
      ) : tab === 'solo' ? (
        !soloStreak ? (
          <div className="card section">
            <p className="screen-subtitle" style={{ margin: 0 }}>
              {soloError ? soloError : 'Loading your solo streak…'}
            </p>
          </div>
        ) : (
          <SoloStreakDetail streak={soloStreak} onBack={null} onInvite={() => setPicking(true)} />
        )
      ) : (
        <div className="card section">
          {streaks.length === 0 ? (
            <p className="screen-subtitle" style={{ marginTop: 0 }}>
              No dual streaks yet -- start one with a friend.
            </p>
          ) : (
            streaks.map((s) => {
              const partnerUid = (s.memberIds || []).find((uid) => uid !== user.uid);
              const partnerName = s.memberNames?.[partnerUid] || 'A traveler';
              return (
                <div key={s.id} className="friend-row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    style={{ flex: 1, display: 'flex', justifyContent: 'space-between', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit' }}
                    onClick={() => setOpenDualId(s.id)}
                  >
                    <span style={{ fontWeight: 700 }}>@{partnerName}</span>
                    <span>
                      {displayStreakCount(s)} {'\u{1F525}\u{1F525}'} {'›'}
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
            })
          )}
          {streaks.length < MAX_ACTIVE_STREAKS && (
            <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setPicking(true)}>
              {'\u{1F525}\u{1F525}'} Start a Dual Streak
            </button>
          )}
        </div>
      )}
    </div>
  );
}
