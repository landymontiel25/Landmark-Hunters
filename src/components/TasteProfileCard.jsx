import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useRatings } from '../lib/RatingsContext';
import { saveTasteBaseline, saveTasteIntro } from '../lib/friends';
import { computeTasteConfidence, votesAsReviews } from '../lib/tasteProfile';
import { getPickFeedback, readLocalFeedback, PICK_VOTE_EVENT } from '../lib/pickFeedback';
import { baselineToSyntheticReviews, extractLegacyBaselineFromIntro } from '../lib/tasteQuestions';
import TasteNudgeCard from './TasteNudgeCard';
import { Skeleton } from './Skeleton';
import ErrorNotice from './ErrorNotice';
import { useSlowLoad } from '../lib/useSlowLoad';

// Taste Profile Score -- Mapr's own leave-one-out prediction confidence
// (see computeTasteConfidence), NOT an activity counter. It only goes up
// when the model's affinity math actually starts guessing your ratings
// right from your OTHER ratings; a narrow or inconsistent rating history
// plateaus it, on purpose. Personal-only, never on any leaderboard. Real
// landmark ratings AND the taste baseline (TasteNudgeCard's like/dislike
// picks, turned into synthetic category-level "ratings" by
// baselineToSyntheticReviews) both feed it, so answering the baseline
// questions moves this score too, not just the free-text profile the AI
// reads.
export default function TasteProfileCard() {
  const { user } = useAuth();
  // profileFresh: true only once a REAL server read of the profile has
  // landed this session. Before that, myProfile is at best the localStorage
  // prefill from some earlier session (which can predate the taste picks
  // entirely) -- rendering that as "you have no picks" is exactly what made
  // the card look empty on app open until something else re-fetched it.
  const { myProfile, profileFresh, reload: reloadFriends } = useFriends();
  const { myReviews } = useRatings();
  const [editing, setEditing] = useState(false);
  // Bridges the gap between "saveTasteBaseline's write resolved" and "the
  // FriendsContext re-render carrying the reloaded myProfile has actually
  // happened" -- without this, closing the editor right after Save could
  // render once (or more) against the STILL-STALE myProfile from before the
  // reload settled, showing the old/empty state until something else (like
  // reopening and closing Edit again) happened to trigger another render
  // after the reload had caught up. Cleared once reloadFriends() in
  // closeEditor below actually resolves, so myProfile is the source of
  // truth again from then on.
  const [justSaved, setJustSaved] = useState(null);
  const migratedRef = useRef(false);
  // Set the instant the Edit card is opened, and checked again right before
  // the migration below actually writes anything. Without this, opening
  // Edit and saving fresh picks could race an in-flight migration -- the
  // migration's write (old picks recovered from legacy tasteIntro text)
  // could land AFTER the user's own save and silently clobber it back to
  // the old values, which is exactly the "my picks aren't saving" bug this
  // guard exists to prevent. Once the user is actively managing their own
  // baseline, the one-time recovery isn't needed anyway.
  const suppressMigrationRef = useRef(false);

  const startEditing = () => {
    suppressMigrationRef.current = true;
    setEditing(true);
  };

  // One-time recovery for accounts that answered the taste nudge before the
  // structured tasteBaseline field existed -- back then, picks were baked
  // straight into the free-text tasteIntro (see extractLegacyBaselineFromIntro
  // for the exact format this recognizes). Those answers never went away,
  // but the Edit button above has nothing to prefill from since it only
  // reads tasteBaseline, so they looked lost. Runs once per load; once
  // tasteBaseline is populated the guard clause below skips it for good.
  useEffect(() => {
    if (!user || migratedRef.current || suppressMigrationRef.current) return;
    // Never decide "there's no baseline, recover one from tasteIntro" off the
    // localStorage prefill -- that snapshot can be from before the picks
    // were ever saved, and acting on it would overwrite the real server
    // baseline with whatever the stale text yields. Wait for a real read.
    if (!profileFresh) return;
    if (myProfile?.tasteBaseline && Object.keys(myProfile.tasteBaseline).length) return;
    if (!myProfile?.tasteIntro) return;
    const { baseline, remainingIntro } = extractLegacyBaselineFromIntro(myProfile.tasteIntro);
    if (!baseline) return;
    migratedRef.current = true;
    (async () => {
      try {
        // Re-check right before writing -- the user may have opened Edit
        // and started saving their own picks while this was in flight.
        if (suppressMigrationRef.current) {
          migratedRef.current = false;
          return;
        }
        await saveTasteBaseline(user.uid, { baseline, notes: '' });
        await saveTasteIntro(user.uid, remainingIntro);
        await reloadFriends();
      } catch {
        migratedRef.current = false;
      }
    })();
  }, [user, profileFresh, myProfile?.tasteIntro, myProfile?.tasteBaseline, reloadFriends]);

  // Mapr Picks ✓/✗ votes count toward the score too (at half weight).
  const [votes, setVotes] = useState({});
  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    setVotes(readLocalFeedback(user.uid));
    getPickFeedback(user.uid)
      .then((fb) => live && setVotes(fb))
      .catch(() => {});
    const onVote = () => setVotes(readLocalFeedback(user.uid));
    window.addEventListener(PICK_VOTE_EVENT, onVote);
    return () => {
      live = false;
      window.removeEventListener(PICK_VOTE_EVENT, onVote);
    };
  }, [user]);

  const profileStuck = useSlowLoad(!!user && !profileFresh && !justSaved && !editing);

  if (!user) return null;

  // The server read hasn't landed yet (and nothing was just saved this
  // session to show in its place): say so, instead of rendering the empty
  // "answer a few quick picks" state -- or letting Edit open pre-filled
  // with nothing -- against data that simply isn't here yet.
  if (!profileFresh && !justSaved && !editing) {
    if (profileStuck) {
      return (
        <div className="card section taste-profile-card">
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{'\u{1F9E9}'} Taste Profile</h3>
          <ErrorNotice
            compact
            message="We couldn't load your taste profile. Check your connection and try again."
            onRetry={() => reloadFriends()}
          />
        </div>
      );
    }
    return (
      <div className="card section taste-profile-card" role="status" aria-live="polite">
        <span className="visually-hidden">Loading your taste profile…</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{'\u{1F9E9}'} Taste Profile</h3>
          <Skeleton width={64} height={28} radius={999} />
        </div>
        <Skeleton height={8} radius={999} style={{ marginTop: 10 }} />
        <Skeleton width="80%" height={11} style={{ marginTop: 10 }} />
      </div>
    );
  }

  // justSaved (set the instant TasteNudgeCard's Save succeeds) wins over
  // myProfile until the reload below confirms it -- see the state comment.
  const effectiveBaseline = justSaved ? justSaved.baseline : myProfile?.tasteBaseline;
  const effectiveNotes = justSaved ? justSaved.notes : myProfile?.tasteBaselineNotes;
  const effectiveCategoryNotes = justSaved ? justSaved.categoryNotes : myProfile?.tasteBaselineCategoryNotes;

  const reviews = [
    ...Object.values(myReviews).map((r) => ({
      tier: r.ratingTier,
      categories: r.categories || [],
      name: r.landmarkName,
      comment: r.comment || '',
      highlights: r.highlights || [],
      updatedAt: r.updatedAt,
    })),
    ...baselineToSyntheticReviews(effectiveBaseline, effectiveCategoryNotes),
    ...votesAsReviews(votes, new Set([...Object.keys(myReviews), ...Object.values(myReviews).map((r) => r.landmarkId)])),
  ];
  const { confidence, sampleCount } = computeTasteConfidence(reviews);
  const hasBaseline = !!(effectiveBaseline && Object.keys(effectiveBaseline).length);

  // `committed` (from an optimistic Save) settles once the write does; if it
  // fails, TasteNudgeCard has already said so with a Retry toast, and we
  // just fall back to the server copy below.
  const closeEditor = async (saved, committed) => {
    if (saved) setJustSaved(saved);
    setEditing(false);
    if (committed) await committed.catch(() => {});
    await reloadFriends();
    // myProfile is caught up now (or this was just a dismiss with nothing
    // to catch up on) -- go back to trusting it as the single source of
    // truth instead of holding onto this forever.
    setJustSaved(null);
  };

  if (editing) {
    return (
      <TasteNudgeCard
        editing
        initialBaseline={effectiveBaseline}
        initialNotes={effectiveNotes}
        initialCategoryNotes={effectiveCategoryNotes}
        onDone={closeEditor}
        onDismiss={closeEditor}
      />
    );
  }

  if (sampleCount < 2) {
    return (
      <div className="card section taste-profile-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{'\u{1F9E9}'} Taste Profile</h3>
          <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 44 }} onClick={startEditing}>
            {hasBaseline ? `${'\u{270F}\u{FE0F}'} Edit` : `${'\u{2795}'} Answer a few quick picks`}
          </button>
        </div>
        <p className="screen-subtitle" style={{ margin: '6px 0 0' }}>
          Rate a couple more places, vote on a few Mapr Picks, or answer the quick-pick questions and Mapr can start
          scoring how well it actually knows your taste.
        </p>
      </div>
    );
  }

  return (
    <div className="card section taste-profile-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{'\u{1F9E9}'} Mapr is still learning your taste: {confidence}%</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={startEditing}>
          {'\u{270F}\u{FE0F}'} Edit
        </button>
      </div>
      <div
        className="level-bar-track"
        style={{ marginTop: 8 }}
        role="progressbar"
        aria-valuenow={confidence}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="level-bar-fill" style={{ width: `${confidence}%` }} />
      </div>
      <p className="screen-subtitle" style={{ margin: '6px 0 0' }}>
        How well Mapr can predict a rating of yours from your OTHER ratings alone. Mapr Picks ✓/✗ votes count at half
        weight. It climbs as your ratings get consistent across different kinds of places, not just with more of them.
      </p>
    </div>
  );
}
