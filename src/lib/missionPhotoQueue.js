import { putJob, registerOutboxHandler, updateJob, flushOutbox } from './outbox';
import { addCheckinPhoto } from './leaderboard';
import { submitMissionPhoto, markMissionDone } from './missions';

// Mission photos checked in the background (owner, 2026-11-24: take the
// photo, tap Done, move on). Once the phone's own check passes (where and
// when it was taken), the photo goes in the outbox (outbox.js) with the
// photo itself, so it survives leaving the screen, closing the app or
// having no signal. The handler uploads it, asks the server to check it
// (api/mission-answer.js) and reports back: passed pays and marks the
// mission done; turned down says what's missing and the mission can be
// retaken. Each step's state is kept on the phone, so the mission panel
// shows it wherever it's opened again.

export const MISSION_PHOTO_EVENT = 'lh:mission-photo';
const STATE_KEY = (uid, landmarkId) => `lh.missionPhoto.${uid}.${landmarkId}`;

export function missionPhotoState(uid, landmarkId) {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY(uid, landmarkId)) || 'null');
  } catch {
    return null;
  }
}
function setState(uid, landmarkId, state) {
  try {
    if (state) localStorage.setItem(STATE_KEY(uid, landmarkId), JSON.stringify(state));
    else localStorage.removeItem(STATE_KEY(uid, landmarkId));
  } catch {
    /* storage blocked: the notice still says how it went */
  }
  try {
    window.dispatchEvent(new CustomEvent(MISSION_PHOTO_EVENT, { detail: { uid, landmarkId, state } }));
  } catch {
    /* no window */
  }
}
export const clearMissionPhotoState = (uid, landmarkId) => setState(uid, landmarkId, null);

export async function queueMissionPhoto({ uid, landmark, file }) {
  const job = await putJob({
    uid,
    kind: 'missionPhoto',
    payload: { landmark: { id: landmark.id, region: landmark.regionId ?? landmark.region, regionId: landmark.regionId ?? landmark.region, name: landmark.name } },
    files: [file],
    giveUpNotice: `Your mission photo at ${landmark.name} couldn't be checked.`,
  });
  setState(uid, landmark.id, { status: 'checking', at: Date.now() });
  flushOutbox(uid).catch(() => {});
  return job;
}

const href = (lm) => `#/landmarks/${lm.region}/${lm.id}`;

export function makeMissionPhotoHandler({ upload = addCheckinPhoto, check = submitMissionPhoto, markDone = markMissionDone } = {}) {
  return async (job) => {
    const lm = job.payload.landmark;
    let photoURL = job.payload.photoURL || null;
    if (!photoURL) {
      try {
        photoURL = await upload(job.uid, lm.id, job.files[0]);
      } catch (e) {
        if (e?.userMessage) {
          setState(job.uid, lm.id, { status: 'failed', lines: [e.userMessage] });
          return { drop: true, notice: e.userMessage };
        }
        return { retry: true, error: 'upload' };
      }
      if (!photoURL) return { retry: true, error: 'upload' };
      await updateJob(job.id, { payload: { ...job.payload, photoURL } });
    }
    let out;
    try {
      out = await check(lm, photoURL);
    } catch (e) {
      const msg = String(e?.userMessage || '');
      // "Couldn't check your photo just now": try again on its own.
      if (!msg || /just now/.test(msg)) return { retry: true, error: msg || 'check' };
      setState(job.uid, lm.id, { status: 'failed', lines: [msg] });
      return { drop: true, notice: `Your mission photo at ${lm.name}: ${msg}`, href: href(lm), actionLabel: 'Open' };
    }
    if (out.passed || out.reason === 'already') {
      const result = { kind: 'photo', awarded: out.awarded || 0 };
      markDone(job.uid, lm.id, result);
      setState(job.uid, lm.id, { status: 'passed', awarded: result.awarded });
      return { done: true, notice: `Mission completed at ${lm.name}.${result.awarded > 0 ? ` +${result.awarded} points.` : ''}`, tone: 'success' };
    }
    const lines = [out.missing && `Missing: ${out.missing}`, out.shows && `You took: ${out.shows}`].filter(Boolean);
    const shown = lines.length ? lines : [out.why || "That photo doesn't do the mission."];
    setState(job.uid, lm.id, { status: 'failed', lines: shown });
    return { done: true, notice: `Your mission photo at ${lm.name} didn't pass. ${shown.map((l) => l.replace(/[.\s]+$/, '')).join('. ')}. Take another one.`, tone: 'error', href: href(lm), actionLabel: 'Retake' };
  };
}

export function registerMissionPhotos(hooks) {
  registerOutboxHandler('missionPhoto', makeMissionPhotoHandler(hooks));
}
