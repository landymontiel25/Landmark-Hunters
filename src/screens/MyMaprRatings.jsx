import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useRatings } from '../lib/RatingsContext';
import { getUserCheckins } from '../lib/leaderboard';
import { deleteMyReview } from '../lib/reviews';
import { getRegion } from '../data/regions';
import { TIERS, tierById, chipLabel } from '../lib/ratingFlow';
import { useToast, runOptimistic } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { SkeletonList } from '../components/Skeleton';
import ErrorNotice from '../components/ErrorNotice';

// Everything rated through "Rate a Landmark" on Mapr Picks -- separate from
// the check-ins list, since these are ratings-only claims (0 points, never
// a "you checked in here"), not visits. Opened from the "X/N today" counter
// on Mapr Picks. Split into the same three tiers RatingFlow itself uses,
// so a rating always lands in the bucket it was actually given.
const TABS = TIERS.map((t) => ({ id: t.id, label: t.label, emoji: t.emoji }));

export default function MyMaprRatings() {
  const navigate = useNavigate();
  const { user, firebaseEnabled } = useAuth();
  const { myReviews, myReviewsLoaded, reload: reloadRatings } = useRatings();
  const toast = useToast();
  const [ratingOnlyIds, setRatingOnlyIds] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [tab, setTab] = useState(TABS[0].id);
  // Removed rows disappear right away; the delete runs behind them and the
  // row comes back (with a Retry toast) if it fails.
  const [hiddenIds, setHiddenIds] = useState(() => new Set());

  const removeRating = (r) => {
    const hide = (on) =>
      setHiddenIds((cur) => {
        const next = new Set(cur);
        if (on) next.add(r.landmarkId);
        else next.delete(r.landmarkId);
        return next;
      });
    runOptimistic({
      apply: () => hide(true),
      commit: async () => {
        await deleteMyReview(user.uid, r.landmarkId);
        await reloadRatings();
      },
      rollback: () => hide(false),
      toast,
      errorMessage: friendlyError(null, `Couldn't remove your rating for ${r.landmarkName || 'that place'}, so it's back.`),
      retry: () => removeRating(r),
    });
  };

  useEffect(() => {
    if (!firebaseEnabled || !user) {
      setRatingOnlyIds(new Set());
      return;
    }
    let cancelled = false;
    setLoadError(null);
    getUserCheckins(user.uid)
      .then((rows) => {
        if (cancelled) return;
        // A ratingOnly claim is an explicit "Rate a Landmark" click, never a
        // real visit -- legacy rows without the field fall back to the old
        // points === 0 heuristic (payout-0 real visits didn't exist yet then).
        setRatingOnlyIds(
          new Set(
            rows
              .filter((c) => (typeof c.ratingOnly === 'boolean' ? c.ratingOnly : c.points === 0))
              .map((c) => c.landmarkId)
          )
        );
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [user, firebaseEnabled, loadAttempt]);

  if (!firebaseEnabled || !user) {
    return (
      <div>
        <p className="screen-subtitle">Sign in on Profile to see your Mapr Picks ratings.</p>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => navigate('/profile')}>
          {'←'} Back to Profile
        </button>
      </div>
    );
  }

  // Also wait for myReviews: before it arrives every tab would read "Nothing rated yet".
  const loading = ratingOnlyIds === null || (!myReviewsLoaded && !loadError);
  const rated = loading
    ? []
    : Object.values(myReviews).filter(
        (r) => ratingOnlyIds.has(r.landmarkId) && r.ratingTier && !hiddenIds.has(r.landmarkId)
      );
  const byTier = { 'highly-recommend': [], 'worth-trying': [], 'probably-skip': [] };
  for (const r of rated) {
    if (byTier[r.ratingTier]) byTier[r.ratingTier].push(r);
  }
  const shown = byTier[tab] || [];

  return (
    <div>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginBottom: 16 }} onClick={() => navigate(-1)}>
        {'← Back'}
      </button>

      <h1 className="screen-title">
        <span>{'\u{2B50}'}</span> My Mapr Ratings
      </h1>
      <p className="screen-subtitle">
        Everything you've rated through Mapr Picks — not places you've checked into, just rated directly.
      </p>

      <div className="tabs" style={{ justifyContent: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab-btn ${tab === t.id ? 'active' : ''}`} aria-pressed={!!(tab === t.id)}
            onClick={() => setTab(t.id)}
          >
            {t.emoji} {t.label} ({byTier[t.id]?.length ?? 0})
          </button>
        ))}
      </div>

      {loading && loadError && (
        <ErrorNotice
          message={friendlyError(loadError, "We couldn't load your ratings. Try again.")}
          onRetry={() => setLoadAttempt((n) => n + 1)}
        />
      )}
      {loading && !loadError && <SkeletonList count={4} label="Loading your ratings" />}

      {!loading && shown.length === 0 && (
        <div className="empty-state">
          <p>Nothing rated {tierById(tab)?.label} yet.</p>
        </div>
      )}

      {shown.map((r) => (
        <div
          key={r.landmarkId}
          className="checkin-row"
          onClick={() => navigate(`/landmarks/${r.region}/${r.landmarkId}`)}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="checkin-name">{r.landmarkName}</div>
            <div className="checkin-sub">{getRegion(r.region)?.name || r.region}</div>
            {r.highlights?.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {r.highlights.map((h) => (
                  <span key={h} className="tag" style={{ fontSize: '0.68rem' }}>
                    {chipLabel(h)}
                  </span>
                ))}
              </div>
            )}
            {r.comment && (
              <p className="checkin-sub" style={{ marginTop: 6, whiteSpace: 'normal' }}>
                “{r.comment}”
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ flexShrink: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              removeRating(r);
            }}
          >
            {`${'\u{1F5D1}\u{FE0F}'} Remove`}
          </button>
        </div>
      ))}
    </div>
  );
}
