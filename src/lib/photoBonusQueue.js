import { putJob, listJobs, registerOutboxHandler, flushOutbox } from './outbox';
import { claimPhotoBonus, photoBonusToast } from './photoBonus';

// The photo bonus check, in the background (owner, 2026-11-25: "couldn't
// check your photo for the bonus. Try again" should never show). Like the
// mission photo (missionPhotoQueue.js) it never holds up the check-in. When
// the check can't run right now (no signal, a server or AI error) it waits
// in the outbox (outbox.js) and is tried again quietly; the bonus is paid
// and a notice says so when the photo passes. A photo that doesn't show the
// place says so plainly, with Retake. Errors in the check itself are never
// shown, not even when it finally gives up.

const landmarkHref = (l) => (l?.region && l?.id ? `#/landmarks/${l.region}/${l.id}` : null);

export async function queuePhotoBonus({ uid, landmarkId, landmark = null }) {
  if (!uid || !landmarkId) return null;
  const waiting = await listJobs(uid, 'photoBonus').catch(() => []);
  if (waiting.some((j) => j.payload?.landmarkId === landmarkId)) return null;
  const plain = landmark ? { id: landmark.id, region: landmark.regionId ?? landmark.region ?? null, name: landmark.name || '' } : null;
  // giveUpNotice null: giving up says nothing (outbox.js).
  const job = await putJob({ uid, kind: 'photoBonus', payload: { landmarkId, landmark: plain }, giveUpNotice: null });
  flushOutbox(uid).catch(() => {});
  return job;
}

export function makePhotoBonusHandler({ claim = claimPhotoBonus } = {}) {
  return async (job) => {
    const { landmarkId, landmark } = job.payload;
    const res = await claim(landmarkId).catch(() => ({ awarded: 0, reason: 'check-failed' }));
    if (res.reason === 'check-failed') return { retry: true, error: 'check-failed' };
    const t = photoBonusToast(res);
    if (!t) return { done: true };
    const href = res.reason === 'photo-not-of-place' ? landmarkHref(landmark) : null;
    return { done: true, notice: t.message, tone: t.tone, ...(href ? { href, actionLabel: 'Retake' } : {}) };
  };
}

export function registerPhotoBonus(hooks) {
  registerOutboxHandler('photoBonus', makePhotoBonusHandler(hooks));
}
