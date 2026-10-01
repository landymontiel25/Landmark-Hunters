import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useRatings } from '../lib/RatingsContext';
import { submitReview, ratingDraftKey } from '../lib/reviews';
import { clearPersisted } from '../lib/usePersistentState';
import { friendlyError } from '../lib/friendlyError';
import ErrorNotice from './ErrorNotice';
import { isRateable } from '../lib/ratingFlow';
import RatingFlow from './RatingFlow';
import { initialRating } from './initialRating';
import { useDisagreementAsk } from '../lib/useDisagreementAsk';

// A "Rate" pill next to a landmark's name (map popup, Landmarks list,
// itinerary card). Shows for every rateable landmark, checked into or not:
// rating a place you haven't been to still teaches Mapr. If you later check
// in there, the check-in prompt asks you to rate again and that rating
// replaces this one. Once rated it reads "Rated · Edit" and opens pre-filled
// from the shared myReviews map, so tapping again edits, never duplicates.
export default function QuickRateButton({ landmark }) {
  const { user, firebaseEnabled } = useAuth();
  const { myUsername } = useFriends();
  const { myReviews, reload: reloadRatings } = useRatings();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { ask: askDisagreement, node: disagreementNode } = useDisagreementAsk();

  if (!firebaseEnabled || !user || !isRateable(landmark)) return null;
  const draftKey = ratingDraftKey(user.uid, landmark.id);

  // Only a review made through the tier + chips flow counts as "rated". A
  // pre-tier review (plain stars, no ratingTier) still shows "Rate" and
  // opens fresh; saving overwrites it.
  const mine = myReviews[landmark.id]?.ratingTier ? myReviews[landmark.id] : null;
  // A legacy comment-only review has no tier but its comment still pre-fills,
  // so picking a tier doesn't blank it.
  const initial = initialRating(myReviews[landmark.id], null);

  const openModal = (e) => {
    e.stopPropagation();
    setError(null);
    setRating(null);
    setOpen(true);
  };

  const close = () => {
    if (!saving) setOpen(false);
  };

  const save = async () => {
    if (!rating || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Two levels from your own earlier answer on this place: asks what happened first.
      const disagreement = await askDisagreement({ userId: user.uid, landmark, tier: rating.tier, comment: rating.comment });
      await submitReview({
        userId: user.uid,
        userName: myUsername || user.displayName || 'Explorer',
        landmark,
        rating,
        disagreement,
      });
    } catch (e) {
      // Modal stays open with every pick intact; Try again resends it.
      setError(e);
      setSaving(false);
      return;
    }
    clearPersisted(draftKey);
    setSaving(false);
    setOpen(false);
    reloadRatings().catch(() => {});
  };

  return (
    <>
      <button
        type="button"
        className={`btn btn-ghost btn-tight quick-rate-btn ${mine ? 'rated' : ''}`}
        onClick={openModal}
      >
        {mine ? '\u{2713} Rated \u{00B7} Edit' : '\u{2B50} Rate'}
      </button>
      {open &&
        createPortal(
          <div className="modal-backdrop" onClick={close}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              {disagreementNode}
              <h3 style={{ marginTop: 0 }}>
                {'\u{2B50}'} {mine ? 'Edit your rating' : 'Rate'} {mine ? 'of ' : ''}
                {landmark.name}
              </h3>
              <p className="screen-subtitle" style={{ marginTop: 0 }}>
                {mine
                  ? 'Already rated — change anything below and save.'
                  : 'How was it? One tap is enough — the rest is optional.'}
              </p>
              <RatingFlow
                key={`${landmark.id}-${open}`}
                landmark={landmark}
                initial={initial}
                draftKey={draftKey}
                onChange={setRating}
              />
              {error && (
                <ErrorNotice
                  compact
                  message={friendlyError(error, "Couldn't save your rating. Your picks are still here — try again.")}
                  onRetry={save}
                />
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn btn-primary btn-block" disabled={saving || !rating} aria-busy={saving} onClick={save}>
                  {saving ? 'Saving…' : mine ? 'Save changes' : 'Save rating'}
                </button>
                <button className="btn btn-ghost" onClick={close} disabled={saving}>
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
