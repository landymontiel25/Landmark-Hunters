import { useState } from 'react';
import { useToast } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { shareCommunityPhoto, rememberPhotoOfferDeclined, claimCommunityPhotoBonus, COMMUNITY_PHOTO_BONUS } from '../lib/communityPhotos';
import { primePlacePhoto } from '../lib/placePhoto';

// "Can we use your photo as the public picture?" A place with no picture of
// its own (and none Google can match) asks the first user who submits a
// photo. Yes: the photo becomes the picture everyone sees. No: nothing is
// saved and the next person who submits a photo is asked instead -- unless
// they take another picture of the place (owner, 2026-11-28: for people who
// don't want their face there), which earns +10 points once it is the place's
// public picture. `onTakeAnother()` picks or takes a photo, saves it as the
// person's own photo of the place and resolves to its URL (null when they
// cancel).
export default function PhotoOfferCard({ landmark, regionId, uid, photoUrl, onDone, onTakeAnother }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // "No thanks" first offers the +10 picture; a second "No thanks" ends it.
  const [step, setStep] = useState('offer');

  const yes = async () => {
    setBusy(true);
    setError(null);
    try {
      const won = await shareCommunityPhoto({ region: regionId, id: landmark.id, url: photoUrl, uid });
      if (won) {
        primePlacePhoto(landmark, { url: photoUrl, attributions: [], community: true });
        toast?.show(`Thanks! Your photo is now the picture of ${landmark.name}.`, { tone: 'success', durationMs: 4000 });
      } else {
        rememberPhotoOfferDeclined(uid, regionId, landmark.id);
        toast?.show('Someone shared a photo of this place just before you. Thanks anyway!', { tone: 'info', durationMs: 4000 });
      }
      onDone(won);
    } catch (e) {
      setError(friendlyError(e, "Couldn't share your photo. Try again."));
      setBusy(false);
    }
  };

  const no = () => {
    if (step === 'offer' && onTakeAnother) {
      setError(null);
      setStep('another');
      return;
    }
    rememberPhotoOfferDeclined(uid, regionId, landmark.id);
    onDone(false);
  };

  const another = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await onTakeAnother();
      if (!url) return;
      const won = await shareCommunityPhoto({ region: regionId, id: landmark.id, url, uid });
      if (!won) {
        rememberPhotoOfferDeclined(uid, regionId, landmark.id);
        toast?.show('Someone shared a photo of this place just before you. Thanks anyway!', { tone: 'info', durationMs: 4000 });
        onDone(false);
        return;
      }
      primePlacePhoto(landmark, { url, attributions: [], community: true });
      const bonus = await claimCommunityPhotoBonus({ region: regionId, id: landmark.id, url });
      toast?.show(
        bonus.awarded > 0
          ? `Thanks! +${bonus.awarded} points. Your photo is now the picture of ${landmark.name}.`
          : `Thanks! Your photo is now the picture of ${landmark.name}.`,
        { tone: 'success', durationMs: 4000 }
      );
      onDone(true);
    } catch (e) {
      setError(friendlyError(e, "Couldn't use that photo. Try again."));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'another') {
    return (
      <div className="card section photo-offer" role="group" aria-label="Take another picture">
        <h3 style={{ marginTop: 0 }}>{'\u{1F4F7}'} Take another picture instead?</h3>
        <p className="screen-subtitle" style={{ marginTop: 0 }}>
          No problem. Take a picture of {landmark.name} without your face in it, and we'll give you {COMMUNITY_PHOTO_BONUS} extra points
          when it becomes the public picture.
        </p>
        {error && <p className="tag tag-error" role="alert">{error}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={another}>
            {busy ? 'Sharing…' : `I'll take another picture · +${COMMUNITY_PHOTO_BONUS} pts`}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={no}>
            No thanks
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card section photo-offer" role="group" aria-label="Share your photo">
      <h3 style={{ marginTop: 0 }}>{'\u{1F4F7}'} No picture of this place yet</h3>
      <p className="screen-subtitle" style={{ marginTop: 0 }}>
        Can we use your photo as the public picture of {landmark.name}? Everyone will see it. If you delete that photo
        later, the picture goes away.
      </p>
      <img
        src={photoUrl}
        alt="Your photo"
        loading="lazy"
        decoding="async"
        style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 10, display: 'block', marginBottom: 12 }}
      />
      {error && <p className="tag tag-error" role="alert">{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={yes}>
          {busy ? 'Sharing…' : 'Yes, use my photo'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={no}>
          No thanks
        </button>
      </div>
    </div>
  );
}
