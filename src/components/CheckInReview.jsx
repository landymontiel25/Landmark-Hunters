import { useCallback, useEffect, useRef, useState } from 'react';
import { initialRating } from './initialRating';
import { useCheckIn } from '../lib/useCheckIn';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useRatings } from '../lib/RatingsContext';
import { useMyPhotos } from '../lib/MyPhotosContext';
import { submitReview, ratingDraftKey } from '../lib/reviews';
import { enqueueRating, RATING_QUEUED_MESSAGE, RATING_QUEUED_PHOTOS_MESSAGE, RATING_QUEUED_WITH_PHOTOS_MESSAGE } from '../lib/ratingQueue';
import { queueCheckinPhoto, queueReviewPhotos, PHOTO_QUEUED_MESSAGE } from '../lib/photoQueue';
import { clearPersisted, markDraftSubmitting, unmarkDraftSubmitting } from '../lib/usePersistentState';
import { friendlyError, isOffline } from '../lib/friendlyError';
import ErrorNotice from './ErrorNotice';
import { attachCheckinPhoto } from '../lib/leaderboard';
import { claimPhotoBonusAndTell, photoButtonLabel, usePhotoBonusOpen } from '../lib/photoBonus';
import { claimLandmarkBonusAndTell } from '../lib/landmarkBonus';
import { useToast } from '../lib/ToastContext';
import { pickPhoto } from '../lib/imageUtils';
import { isRateable, diversityHint } from '../lib/ratingFlow';
import RatingFlow from './RatingFlow';
import TipComposer from './tips/TipComposer';
import { hasMyTip } from '../lib/tipCheckin';
import { useDisagreementAsk } from '../lib/useDisagreementAsk';
import CheckInBlast from './CheckInBlast';
import { useGeo } from '../lib/GeoContext';
import { presenceLabel } from '../lib/presence';
import MissionPanel from './MissionPanel';
import MissionResult from './MissionResult';
import { missionFor } from '../lib/missionAnswerQueue';
import { OFFLINE_HINT, OFFLINE_SAVED_MESSAGE } from '../lib/offlineCheckins';

// Pops up the moment "Check In" is tapped -- nothing is claimed yet. Tapping
// Post is what actually registers the check-in (via commitCheckIn) and awards
// the points; Cancel walks away with nothing recorded at all.
//
// Rateable landmarks (history, art, food) get the tier -> chips -> aspects
// flow. A campus-only spot skips rating entirely: one tap confirms the
// check-in, since there's nothing useful Mapr could learn from ranking a
// dorm on Food/Service.
export default function CheckInReview() {
  const { justCheckedIn, checkInOptions, celebration, commitCheckIn, clearJustCheckedIn, claimedMap, presenceResult } = useCheckIn();
  const requireComment = !!checkInOptions?.requireComment;
  // Rate a Landmark (Profile) claims the check-in for 0 points -- see
  // commitCheckIn in CheckInContext. No points were awarded, so this skips
  // the confetti blast and the "+N pts" copy entirely rather than show "+0".
  const ratingOnly = !!checkInOptions?.ratingOnly;
  const toast = useToast();
  // +10 for a photo of a place you checked in to (api/_lib/photoBonus.js
  // decides and checks the photo; a rating-only claim never qualifies).
  const { user } = useAuth();
  const [photoBonusOpen, markPhotoBonusPaid] = usePhotoBonusOpen(user?.uid, ratingOnly ? null : justCheckedIn?.id);
  const askPhotoBonus = (landmarkId) => claimPhotoBonusAndTell(landmarkId, toast, { uid: user?.uid, landmark: justCheckedIn?.landmark || justCheckedIn, onRetake: () => { window.location.hash = `/landmarks/${(justCheckedIn?.landmark || justCheckedIn)?.regionId ?? (justCheckedIn?.landmark || justCheckedIn)?.region}/${landmarkId}`; } }).then(markPhotoBonusPaid);
  const { coords } = useGeo();
  const { myUsername } = useFriends();
  const { myReviews, reload: reloadRatings } = useRatings();
  const { reload: reloadMyPhotos } = useMyPhotos();
  const { ask: askDisagreement, node: disagreementNode } = useDisagreementAsk();
  const [rating, setRating] = useState(null);
  const [photoFiles, setPhotoFiles] = useState([]);
  const [photoPreviews, setPhotoPreviews] = useState([]);
  const [saving, setSaving] = useState(false);
  const [offlineSaved, setOfflineSaved] = useState(false);
  // 'offer' | 'open' | 'done': the "Share a tip for others?" step after a verified visit.
  const [tipState, setTipState] = useState('offer');
  const [hasTipHere, setHasTipHere] = useState(null);
  // A tip is being shared: the sheet stays open until it answers.
  const [tipBusy, setTipBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // The check-in write itself failed: shown with Try again, and everything
  // you picked (rating, comment, photos) stays in the form.
  const [postError, setPostError] = useState(null);
  const [posted, setPosted] = useState(false);
  // When this check-in posted: a photo mission must be taken after it.
  const [postedAt, setPostedAt] = useState(null);
  // The full-screen blast shows the instant a check-in posts, then hands
  // off to the quieter "Checked in!" panel below (with "+N pts" only when
  // this check-in paid: the account's first one ever).
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

  // The check-in this modal is showing right now. Background saves compare
  // against it so a late error from an earlier check-in can't land on the
  // next one's modal.
  const currentCheckIn = useRef(justCheckedIn);
  useEffect(() => {
    currentCheckIn.current = justCheckedIn;
  }, [justCheckedIn]);

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
      setOfflineSaved(false);
      setBlast(false);
      setTipState('offer');
      setHasTipHere(null);
    }
  }, [justCheckedIn]);

  // One tip per person per place: no offer where you already have one (an
  // unknown answer still offers; the server refuses a second tip).
  useEffect(() => {
    // Only when a tip could be offered at all.
    if (!justCheckedIn || !user?.uid || !user.emailVerified || checkInOptions?.ratingOnly) return undefined;
    let cancelled = false;
    hasMyTip(user.uid, justCheckedIn.id, justCheckedIn.regionId || justCheckedIn.region).then((has) => {
      if (!cancelled) setHasTipHere(has);
    });
    return () => {
      cancelled = true;
    };
  }, [justCheckedIn, user?.uid, user?.emailVerified, checkInOptions?.ratingOnly]);

  // The trivia mission answered in this sheet (owner, 2026-11-25): Done
  // first shows the result screen (right or wrong, and the right answer),
  // and only its own Done closes. Done tapped while the answer is still
  // being checked waits for it, then shows the result.
  const [trivia, setTrivia] = useState(null); // null | 'answering' | { result }
  const [resultOpen, setResultOpen] = useState(false);
  const [closeAfterAnswer, setCloseAfterAnswer] = useState(false);
  const onTrivia = useCallback((e) => {
    if (e.status === 'answering') setTrivia('answering');
    else if (e.status === 'answered') setTrivia({ result: e.result });
    else {
      setTrivia(null);
      setCloseAfterAnswer(false);
    }
  }, []);
  useEffect(() => {
    if (closeAfterAnswer && trivia?.result) {
      setCloseAfterAnswer(false);
      setResultOpen(true);
    }
  }, [closeAfterAnswer, trivia]);
  useEffect(() => {
    setTrivia(null);
    setResultOpen(false);
    setCloseAfterAnswer(false);
  }, [justCheckedIn?.id]);

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
    let result;
    try {
      // The server stays the gate here: nothing reads as "checked in" (and
      // no points show) until this resolves, so a refused or failed claim
      // can never look like it counted. With no internet the check-in, its
      // rating and its photos are saved on the phone instead and sync on
      // their own (offlineCheckins.js); points come once the server checks it.
      const offlineReview = rateable
        ? JSON.parse(JSON.stringify({ userId: user.uid, userName: myUsername || user.displayName || 'Explorer', landmark: justCheckedIn, rating, disagreement: disagreement ?? null }))
        : null;
      result = await commitCheckIn(coords, { review: offlineReview, photos: photoFiles });
    } catch (e) {
      // The check-in write itself failed -- no points awarded, nothing to
      // show as posted.
      setPostError(e);
      setSaving(false);
      return;
    }
    if (result?.queuedOffline) {
      if (rateable) clearPersisted(draftKey);
      setOfflineSaved(true);
      setPosted(true);
      setPostedAt(Date.now());
      setBlast(false);
      setSaving(false);
      setMsg(result.offlineMessage || OFFLINE_SAVED_MESSAGE);
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
    setPostedAt(Date.now());
    setBlast(!ratingOnly);
    setSaving(false);
    const thisCheckIn = justCheckedIn;
    // A place's own bonus (the Alhambra Water Tower's 1,000), once per account.
    if (!ratingOnly) claimLandmarkBonusAndTell(thisCheckIn, toast);
    const setBgMsg = (m) => {
      if (currentCheckIn.current === thisCheckIn) setMsg(m);
    };

    if (rateable) {
      // The draft stays in storage until the save lands (so a failure keeps
      // it), but is flagged so the landmark page doesn't call it "restored"
      // while this is still uploading.
      markDraftSubmitting(draftKey);
      const reviewArgs = {
        userId: user.uid,
        userName: myUsername || user.displayName || 'Explorer',
        landmark: justCheckedIn,
        rating,
        disagreement,
      };
      // Retried, logged, and kept on this phone if it still can't save
      // (ratingQueue.js), so this never ends on "couldn't save".
      const save = (files) => submitReview({ ...reviewArgs, photoFiles: files }, { source: 'checkin' });
      save(photoFiles)
        // A rating holds 3 photos. On a repeat visit the old ones can fill it,
        // and the cap used to refuse the whole rating: save the rating, and
        // put the new photos on this check-in instead.
        .catch(async (e) => {
          if (!photoFiles.length || !/holds up to|the most it can hold/.test(String(e?.message || ''))) throw e;
          const res = await save([]);
          let photoFailed = false;
          let photoQueued = false;
          for (const f of photoFiles) {
            try {
              await attachCheckinPhoto(user.uid, justCheckedIn.id, f);
            } catch (err) {
              if (!err?.userMessage && (await queueCheckinPhoto({ userId: user.uid, landmarkId: justCheckedIn.id, landmarkName: justCheckedIn.name, file: f }).catch(() => null))) photoQueued = true;
              else photoFailed = true;
            }
          }
          return { ...res, photoFailed, photoQueued: photoQueued || res.photoQueued };
        })
        .then(async (res) => {
          if (res?.queued) {
            // Waiting on this phone; the draft stays so the landmark page
            // shows it until the queue sends it.
            unmarkDraftSubmitting(draftKey);
            setBgMsg(res.photoQueued ? RATING_QUEUED_WITH_PHOTOS_MESSAGE : res.photosDropped ? RATING_QUEUED_PHOTOS_MESSAGE : RATING_QUEUED_MESSAGE);
            return;
          }
          // Saved -- the in-progress copy on this device isn't needed. (On
          // failure it's kept, so the landmark page reopens with it.)
          clearPersisted(draftKey);
          unmarkDraftSubmitting(draftKey);
          await Promise.all([reloadRatings(), reloadMyPhotos()]).catch(() => {});
          if (res?.photoQueued) setBgMsg(PHOTO_QUEUED_MESSAGE);
          else if (res?.photoFailed) setBgMsg("Your photo couldn't upload. You can add it again from the landmark page.");
          else if (photoFiles.length && !ratingOnly) askPhotoBonus(justCheckedIn.id);
        })
        .catch(async (e) => {
          unmarkDraftSubmitting(draftKey);
          // Only a mistake the person has to fix gets here; it says what to
          // change. Anything else is kept on this phone like any failed save.
          if (e?.userMessage) {
            setBgMsg(`${e.userMessage} Your picks are kept on the landmark page.`);
            return;
          }
          enqueueRating(reviewArgs);
          const photosQueued = photoFiles.length ? await queueReviewPhotos({ userId: user.uid, landmark: justCheckedIn, files: photoFiles }).catch(() => null) : null;
          setBgMsg(photosQueued ? RATING_QUEUED_WITH_PHOTOS_MESSAGE : photoFiles.length ? RATING_QUEUED_PHOTOS_MESSAGE : RATING_QUEUED_MESSAGE);
        });
    } else if (photoFiles.length) {
      // No rating here, so the photo lives on the check-in doc instead.
      // Every photo picked, one after another -- not just the first.
      (async () => {
        let failed = false;
        let queued = false;
        for (const f of photoFiles) {
          try {
            await attachCheckinPhoto(user.uid, justCheckedIn.id, f);
          } catch (err) {
            // No connection: it waits on this phone and uploads on its own.
            if (!err?.userMessage && (await queueCheckinPhoto({ userId: user.uid, landmarkId: justCheckedIn.id, landmarkName: justCheckedIn.name, file: f }).catch(() => null))) queued = true;
            else failed = true;
          }
        }
        await reloadMyPhotos().catch(() => {});
        if (failed) setBgMsg("Some photos couldn't upload. You can add them again from the landmark page.");
        else if (queued) setBgMsg(PHOTO_QUEUED_MESSAGE);
        if (!ratingOnly && (!failed || photoFiles.length > 1)) askPhotoBonus(justCheckedIn.id);
      })();
    }
  };

  const close = () => {
    if (tipBusy) return;
    if (trivia === 'answering') {
      setCloseAfterAnswer(true);
      return;
    }
    if (trivia?.result && !resultOpen) {
      setResultOpen(true);
      return;
    }
    clearJustCheckedIn();
  };

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
        {posted && resultOpen && trivia?.result ? (
          <MissionResult mission={missionFor(justCheckedIn.landmark || justCheckedIn)} result={trivia.result} onDone={clearJustCheckedIn} />
        ) : posted ? (
          <>
            <h3 style={{ marginTop: 0 }}>
              {offlineSaved
                ? `${'\u{1F4E5}'} Saved on your phone`
                : ratingOnly
                  ? `${'\u{2B50}'} Rated!`
                  : `${'\u{1F3AF}'} Checked in!${celebration?.points > 0 ? ` +${celebration.points} pts` : ''}`}
            </h3>
            {!ratingOnly && celebration?.message && <div className="celebration-banner">{celebration.message}</div>}
            {!ratingOnly && presenceResult && presenceResult.landmarkId === justCheckedIn.id && (
              <p className={`presence-line ${presenceResult.verified ? 'presence-verified' : ''}`} style={{ marginTop: 8, marginBottom: 0 }}>
                {presenceResult.verified ? '\u2713 ' : ''}
                {presenceLabel(presenceResult)}
              </p>
            )}
            {msg && (
              <p className="screen-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
                {msg}
              </p>
            )}
            {/* The place's mission (the Abacos), unlocked now that the check-in posted,
                and right away for one saved offline too (it ships with the app;
                the answer is checked once the check-in syncs). */}
            {!ratingOnly && <MissionPanel key={justCheckedIn.id} landmark={justCheckedIn.landmark || justCheckedIn} checkedInAt={postedAt} onTrivia={onTrivia} offline={!!offlineSaved} />}
            {/* After a verified visit, the rating flow offers a tip (Phase 1). */}
            {!ratingOnly && presenceResult?.verified && presenceResult.landmarkId === justCheckedIn.id && user?.emailVerified && hasTipHere !== true && tipState !== 'done' && (
              <div style={{ marginTop: 12 }}>
                {tipState === 'open' ? (
                  <TipComposer
                    uid={user.uid}
                    checkinId={presenceResult.checkinId}
                    landmarkName={justCheckedIn.name}
                    onCancel={() => setTipState('done')}
                    onBusyChange={setTipBusy}
                    onPosted={(out) => {
                      setTipState('done');
                      setMsg(out?.status === 'held' ? 'Thanks! Your tip shows once it is reviewed.' : 'Thanks! Your tip is up on the landmark page.');
                    }}
                  />
                ) : (
                  <button type="button" className="btn btn-ghost btn-block" onClick={() => setTipState('open')}>
                    {/* A place someone added (Add a landmark): a new find to share (Phase 3). */}
                    {'\u{1F4A1}'} {(justCheckedIn.landmark || justCheckedIn).createdBy ? 'Share this find?' : 'Share a tip for others?'}
                  </button>
                )}
              </div>
            )}
            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={close} disabled={tipBusy}>
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
                  Mapr gets smarter with every rating you give. Rate for you, and your next picks improve.
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
                  tagUid={user?.uid}
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
                  {photoButtonLabel(`\u{1F4F8} Add photo (${photoFiles.length}/3)`, photoBonusOpen)}
                </button>
              </div>
            )}

            {msg && (
              <p className="screen-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
                {msg}
              </p>
            )}
            {!ratingOnly && isOffline() && (
              <p className="screen-subtitle offline-checkin-hint" role="note" style={{ marginTop: 8, marginBottom: 0 }}>
                {OFFLINE_HINT}
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
