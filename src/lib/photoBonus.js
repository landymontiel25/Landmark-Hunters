import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { authHeaders } from './apiAuth';
import { API_BASE } from './apiBase';
import { dayKey } from './streaks';

// Asks the server for the photo bonus (api/_lib/photoBonus.js: +10 the
// first time you add a photo at a place you checked in to, once per place,
// 5 places a day, and only if the photo shows the place). Called after a
// photo saves. Best effort: a failure never touches the photo itself.
// Resolves to { awarded, reason, expected, why } (awarded 0 when none).
// retry: check the newest photo again even if it was turned down before.
export async function claimPhotoBonus(landmarkId, { retry = false } = {}) {
  if (!landmarkId) return { awarded: 0, reason: null };
  try {
    const r = await fetch(`${API_BASE}/api/photo-bonus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ landmarkId, dayId: dayKey(new Date()), ...(retry ? { retry: true } : {}) }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) return { awarded: 0, reason: 'check-failed' };
    return { awarded: Number(data.awarded) || 0, reason: data.reason || null, expected: data.expected || null, why: data.why || null };
  } catch {
    // Offline or the server didn't answer: never a silent no.
    return { awarded: 0, reason: 'check-failed' };
  }
}

const sentence = (t) => {
  const s = String(t || '').trim();
  return s ? (/[.!?]$/.test(s) ? s : `${s}.`) : '';
};

// The toast after a photo, or null for nothing to say (already paid, no
// photo). A photo that doesn't show the place says so plainly, with Retake
// (`retake`). A check that couldn't run says nothing: it's tried again in
// the background (photoBonusQueue.js; owner, 2026-11-25).
export function photoBonusToast({ awarded, reason, expected, why }) {
  if (awarded > 0) return { message: `\u{1F4F8} +${awarded} pts for your photo!`, tone: 'success' };
  if (reason === 'photo-not-of-place') {
    const need = expected ? ` It needs ${sentence(expected)}` : ' It needs a photo of the place.';
    return { message: `No photo bonus: your photo doesn't show the place.${why ? ` ${sentence(why)}` : ''}${need} Take another one for the bonus.`, tone: 'info', retake: true };
  }
  if (reason === 'check-limit') return { message: "That's all the photo checks for today. Add your photo again tomorrow for the bonus.", tone: 'info' };
  if (reason === 'check-failed') return null;
  if (reason === 'no-checkin') return { message: 'Check in here first to earn the photo bonus.', tone: 'info' };
  if (reason === 'daily-limit') return { message: "That's today's 5 photo bonuses. Photos tomorrow can earn more.", tone: 'info' };
  return null;
}

// The "+10 pts" on an Add photo button: shown until this place's bonus is
// paid (photo_bonuses/{uid}_{landmarkId}, readable by its owner). Until the
// read answers, the label stays off so it never flashes on and away.
export const PHOTO_BONUS_LABEL = '+10 pts';
export const photoButtonLabel = (base, open) => (open ? `${base} \u00B7 ${PHOTO_BONUS_LABEL}` : base);

export function usePhotoBonusOpen(uid, landmarkId) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!uid || !landmarkId || !db) {
      setOpen(false);
      return undefined;
    }
    let live = true;
    getDoc(doc(db, 'photo_bonuses', `${uid}_${landmarkId}`))
      .then((snap) => live && setOpen(!snap.exists()))
      .catch(() => live && setOpen(false));
    return () => {
      live = false;
    };
  }, [uid, landmarkId]);
  // After a paid photo, the label goes away without another read.
  const markPaid = (res) => {
    if (res?.awarded > 0) setOpen(false);
    return res;
  };
  return [open, markPaid];
}

// Asks in the background, then shows the toast (if any) with the app's
// toast.show. Never holds anything up. When the check couldn't run (offline,
// a server error) it goes in the outbox and is tried again quietly
// (photoBonusQueue.js). `onRetake` opens the camera or photo picker again.
export function claimPhotoBonusAndTell(landmarkId, toast, { retry = false, uid = null, landmark = null, onRetake = null } = {}) {
  return claimPhotoBonus(landmarkId, { retry }).then(async (res) => {
    if (res.reason === 'check-failed') {
      const { queuePhotoBonus } = await import('./photoBonusQueue');
      await queuePhotoBonus({ uid, landmarkId, landmark }).catch(() => null);
      return res;
    }
    const t = photoBonusToast(res);
    if (t) {
      toast.show(t.message, {
        tone: t.tone,
        ...(t.retake && onRetake ? { actionLabel: 'Retake', onAction: onRetake, durationMs: 12000 } : {}),
      });
    }
    return res;
  });
}
