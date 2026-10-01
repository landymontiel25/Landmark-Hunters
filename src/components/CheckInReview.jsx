import { useCallback, useEffect, useRef, useState } from 'react';
import { initialRating } from './initialRating';
import { useCheckIn } from '../lib/useCheckIn';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useRatings } from '../lib/RatingsContext';
import { useMyPhotos } from '../lib/MyPhotosContext';
import { submitReview, ratingDraftKey } from '../lib/reviews';
import { clearPersisted, markDraftSubmitting, unmarkDraftSubmitting } from '../lib/usePersistentState';
import { friendlyError } from '../lib/friendlyError';
import ErrorNotice from './ErrorNotice';
import { attachCheckinPhoto } from '../lib/leaderboard';
import { pickPhoto } from '../lib/imageUtils';
import { isRateable, diversityHint } from '../lib/ratingFlow';
import RatingFlow from './RatingFlow';
import { useDisagreementAsk } from '../lib/useDisagreementAsk';
import CheckInBlast from './CheckInBlast';

// Pops up the moment "Check In" is tapped -- nothing is claimed yet. Tapping
// Post is what actually registers the check-in (via commitCheckIn) and awards
// the points; Cancel walks away with nothing recorded at all.
//
// Rateable landmarks (history, art, food) get the tier -> chips -> aspects
// flow. A campus-only spot skips rating entirely: one tap confirms the
// check-in, since there's nothing useful Mapr could learn from ranking a
// dorm on Food/Service.
export default function CheckInReview() {
  const { justCheckedIn, checkInOptions, celebration, commitCheckIn, clearJustCheckedIn, claimedMap } = useCheckIn();
  const requireComment = !!checkInOptions?.requireComment;
  // Rate a Landmark (Profile) claims the check-in for 0 points -- see
  // commitCheckIn in CheckInContext. No points were awarded, so this skips
  // the confetti blast and the "+N pts" copy entirely rather than show "+0".
  const ratingOnly = !!checkInOptions?.ratingOnly;
  const { user } = useAuth();
  const { myUsername } = useFriends();
  const { myReviews, reload: reloadRatings } = useRatings();
  const { reload: reloadMyPhotos } = useMyPhotos();
  const { ask: askDisagreement, node: disagreementNode } = useDisagreementAsk();
  const [rating, setRating] = useState(null);
  const [photoFiles, setPhotoFiles] = useState([]);
  const [photoPreviews, setPhotoPreviews] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  // The check-in write itself failed: shown with Try again, and everything
  // you picked (rating, comment, photos) stays in the form.
  const [postError, setPostError] = useState(null);
  const [posted, setPosted] = useState(false);
  // The full-screen blast shows the instant a check-in posts, then hands
  // off to the quieter "Checked in! +100" panel below.
  const [blast, setBlast] = useState(false);
  const endBlast = useCallback(() => setBlast(false), []);
  // Every preview blob URL made, so they can be released (they otherwise
  // hold the full photo in memory until the page closes).
  const previewUrls = useRef(new Set());
  const makePreview = (f) => {
    const u = URL.createObjectURL(f);
    previewUrls.current.add(u);
    return u;
  };
  const releasePreview = (u) => {
    if (previewUrls.current.delete(u)) URL.revokeObjectURL(u);
  };
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (justCheckedIn) {
      // No setRating(null) here: RatingFlow (mounted in this same commit)
      // reports its own starting state, including a pre-picked tier or a
      // restored draft, and this effect runs after it and would wipe that.
      previewUrls.current.forEach((u) => URL.revokeObjectURL(u));
      previewUrls.current.clear();
      setPhotoFiles([]);
      setPhotoPreviews([]);
      setMsg(null);
      setPostError(null);
      setPosted(false);
      setBlast(false);
    }
  }, [justCheckedIn]);

  if (!justCheckedIn) return null;

  const rateable = isRateable(justCheckedIn);
  const draftKey = ratingDraftKey(user?.uid, justCheckedIn.id);
  // Re-checking in at a place you already rated: start from what's on file so
  // posting doesn't blank the saved comment, chips and love notes.
  const existing = myReviews?.[justCheckedIn.id] || null;
  // Rated before ever visiting (rating needs no check-in): the real visit
  // asks again. The old pick is the starting point, but Post saves what's on
  // screen as the new rating, replacing the earlier one.
  const ratedBeforeVisit = !ratingOnly && !!existing?.ratingTier && !claimedMap?.[justCheckedIn.id];

  const onPhoto = async () => {
    let f;
    try {
      f = await pickPhoto();
    } catch (e) {
      setMsg(friendlyError(e, "Couldn't use that photo. Try another one."));
      return;
    }
    if (f && photoFiles.length < 3) {
      setPhotoFiles((prev) => (prev.length < 3 ? [...prev, f] : prev));
      setPhotoPreviews((prev) => (prev.length < 3 ? [...prev, makePreview(f)] : prev));
    }
  };
  const removePhoto = (i) => {
    releasePreview(photoPreviews[i]);
    setPhotoFiles((prev) => prev.filter((_, idx) => idx !== i));
    setPhotoPreviews((prev) => prev.filter((_, idx) => idx !== i));
  };

  const submit = async () => {
    if (rateable && !rating) {
      setMsg('Pick one of the three first.');
      return;
    }
    if (rateable && requireComment && !rating?.comment?.trim()) {
      setMsg('Add a quick comment — Mapr needs to know why, not just yes or no.');
      return;
    }
    setSaving(true);
    setMsg(null);
    setPostError(null);
    // A re-rating two levels from your own earlier answer on this place asks
    // what happened first (before anything is posted, so closing can't lose it).
    const disagreement = rateable
      ? await askDisagreement({ userId: user.uid, landmark: justCheckedIn, tier: rating.tier, comment: rating.comment })
      : undefined;
    try {
      // The server stays the gate here: nothing reads as "checked in" (and
      // no points show) until this resolves, so a refused or failed claim
      // can never look like it counted.
      await commitCheckIn();
    } catch (e) {
      // The check-in write itself failed -- no points awarded, nothing to
      // show as posted.
      setPostError(e);
      setSaving(false);
      return;
    }
    // Points are awarded and the visit counted the instant commitCheckIn
    // resolves -- that's the whole check-in as far as the traveler's
    // concerned, so celebrate right away instead of making them sit through
    // the rating/photo save (which, with photos, can take several seconds
    // per photo) and two reload queries first. Everything below this line
    // is a bonus save that runs in the background; a failure there shows up
    // as a small note under the already-posted success panel, it never
    // delays or reads as "check-in failed" when it actually succeeded.
    setPosted(true);
    setBlast(!ratingOnly);
    setSaving(false);

    if (rateable) {
      // The draft stays in storage until the save lands (so a failure keeps
      // it), but is flagged so the landmark page doesn't call it "restored"
      // while this is still uploading.
      markDraftSubmitting(draftKey);
      submitReview({
        userId: user.uid,
        userName: myUsername || user.displayName || 'Explorer',
        landmark: justCheckedIn,
        rating,
        photoFiles,
        disagreement,
      })
        .then(async (res) => {
          // Saved -- the in-progress copy on this device isn't needed. (On
          // failure it's kept, so the landmark page reopens with it.)
          clearPersisted(draftKey);
          unmarkDraftSubmitting(draftKey);
          await Promise.all([reloadRatings(), reloadMyPhotos()]).catch(() => {});
          if (res?.photoFailed) setMsg("Your photo couldn't upload — you can try again from the landmark page.");
        })
        .catch(() => {
          unmarkDraftSubmitting(draftKey);
          setMsg("Your rating couldn't save — you can try rating it again from the landmark page.");
        });
    } else if (photoFiles.length) {
      // No rating here, so the photo lives on the check-in doc instead.
      // Every photo picked, one after another -- not just the first.
      (async () => {
        let failed = false;
        for (const f of photoFiles) {
          try {
            await attachCheckinPhoto(user.uid, justCheckedIn.id, f);
          } catch {
            failed = true;
          }
        }
        await reloadMyPhotos().catch(() => {});
        if (failed) setMsg("Some photos couldn't upload — you can try again from the landmark page.");
      })();
    }
  };

  const close = () => clearJustCheckedIn();

  if (posted && blast) {
    return (
      <CheckInBlast
        landmarkName={justCheckedIn.landmark?.name || justCheckedIn.name || ''}
        points={celebration?.points ?? 0}
        message={celebration?.message}
        onDone={endBlast}
      />
    );
  }

  return (
    <div className="modal-backdrop" onClick={() => !saving && close()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {disagreementNode}
        {posted ? (
          <>
            <h3 style={{ marginTop: 0 }}>
              {ratingOnly ? `${'\u{2B50}'} Rated!` : `${'\u{1F3AF}'} Checked in!${celebration?.points > 0 ? ` +${celebration.points} pts` : ''}`}
            </h3>
            {!ratingOnly && celebration?.message && <div className="celebration-banner">{celebration.message}</div>}
            {msg && (
              <p className="screen-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
                {msg}
              </p>
            )}
            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={close}>
              Done
            </button>
          </>
        ) : (
          <>
            <h3 style={{ marginTop: 0 }}>
              {'\u{1F4CD}'} {requireComment ? `Rate ${justCheckedIn.name}` : `Check in to ${justCheckedIn.name}?`}
            </h3>
            {rateable ? (
              <>
                <p className="screen-subtitle" style={{ marginTop: 0 }}>
                  {requireComment
                    ? 'This also claims a check-in — a comment is required so Mapr knows why.'
                    : 'How was it? One tap is enough — the rest is optional.'}
                </p>
                {ratedBeforeVisit && (
                  <p className="screen-subtitle" style={{ marginTop: -10, fontSize: '0.78rem' }}>
                    {'\u{1F501}'} You rated this before you visited. Now that you're here, confirm or change it — this
                    rating replaces the earlier one.
                  </p>
                )}
                <p className="screen-subtitle" style={{ marginTop: -10, fontSize: '0.78rem' }}>
                  Rate for yourself, not others. This is just so we learn your taste.
                </p>
                {(() => {
                  const hint = diversityHint(Object.values(myReviews));
                  return hint ? (
                    <p className="screen-subtitle" style={{ marginTop: -10, fontSize: '0.78rem' }}>
                      {'\u{1F4A1}'} {hint}
                    </p>
                  ) : null;
                })()}
                <RatingFlow
                  key={justCheckedIn.id}
                  landmark={justCheckedIn}
                  initial={initialRating(existing, checkInOptions?.initialTier)}
                  onChange={setRating}
                  requireComment={requireComment}
                  draftKey={draftKey}
                />
              </>
            ) : (
              <p className="screen-subtitle" style={{ marginTop: 0 }}>
                Add a photo if you like, then tap Confirm.
              </p>
            )}

            {photoPreviews.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {photoPreviews.map((src, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img
                      src={src}
                      alt={`Photo ${i + 1}`}
                      style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 10, display: 'block' }}
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      aria-label="Remove photo"
                      style={{
                        position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%',
                        border: 'none', background: 'rgba(0,0,0,0.78)', color: '#fff', cursor: 'pointer', lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {photoFiles.length < 3 && (
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onPhoto}>
                  {'\u{1F4F8}'} Add photo ({photoFiles.length}/3)
                </button>
              </div>
            )}

            {msg && (
              <p className="screen-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
                {msg}
              </p>
            )}
            {postError && (
              <ErrorNotice
                compact
                message={friendlyError(postError, "Couldn't check in. Nothing was counted — try again.")}
                onRetry={submit}
              />
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                className="btn btn-primary btn-block"
                disabled={saving || (rateable && !rating) || (rateable && requireComment && !rating?.comment?.trim())}
                aria-busy={saving}
                onClick={submit}
              >
                {saving ? 'Posting…' : rateable ? 'Post' : 'Confirm check-in \u{2713}'}
              </button>
              <button className="btn btn-ghost" onClick={close} disabled={saving}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
