import { putJob, registerOutboxHandler, listJobs, flushOutbox } from './outbox';
import { submitMissionAnswer, markMissionDone, missionOf } from './missions';
import { getLandmark } from '../data/regions';

// Missions after an offline check-in (owner, 2026-11-25). The missions ship
// with the app (src/data/landmarks.abacos.js), so a check-in saved on the
// phone shows its mission right away. A trivia answer given offline waits in
// the outbox (outbox.js) like the check-in itself; once the check-in has
// synced, the server checks the answer and pays (api/_lib/missionAnswer.js),
// and the result screen shows whether it was right and the right answer
// (MissionResultSync). The right answer only ever comes from the server,
// after the answer. A mission photo taken offline waits the same way
// (missionPhotoQueue.js).

export const MISSION_RESULT_EVENT = 'lh:mission-result';
const STATE_KEY = (uid, landmarkId) => `lh.missionAnswer.${uid}.${landmarkId}`;

// The mission for a landmark, from the object at hand or the app's own data.
export function missionFor(landmark) {
  if (!landmark) return null;
  const own = missionOf(landmark);
  if (own) return own;
  const region = landmark.regionId ?? landmark.region;
  return region && landmark.id ? missionOf(getLandmark(region, landmark.id)) : null;
}

// An answer saved on this phone and not checked yet: { picked, at } or null.
export function queuedMissionAnswer(uid, landmarkId) {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY(uid, landmarkId)) || 'null');
  } catch {
    return null;
  }
}
function setQueued(uid, landmarkId, v) {
  try {
    if (v) localStorage.setItem(STATE_KEY(uid, landmarkId), JSON.stringify(v));
    else localStorage.removeItem(STATE_KEY(uid, landmarkId));
  } catch {
    /* storage blocked: the outbox job still carries the answer */
  }
}

const plain = (l) => ({ id: l.id, region: l.regionId ?? l.region ?? null, regionId: l.regionId ?? l.region ?? null, name: l.name || '' });

export async function queueMissionAnswer({ uid, landmark, answer }) {
  const job = await putJob({ uid, kind: 'missionAnswer', payload: { landmark: plain(landmark), answer }, giveUpNotice: `Your mission answer at ${landmark.name} couldn't be sent.` });
  setQueued(uid, landmark.id, { picked: answer, at: Date.now() });
  flushOutbox(uid).catch(() => {});
  return job;
}

// A mission job waits while this landmark's offline check-in hasn't synced:
// the server only takes an answer or photo after a verified check-in.
export async function checkinStillQueued(uid, landmarkId, list = listJobs) {
  const jobs = await list(uid, 'checkin').catch(() => []);
  return jobs.some((j) => j.payload?.landmarkId === landmarkId);
}

const announce = (detail) => {
  try {
    window.dispatchEvent(new CustomEvent(MISSION_RESULT_EVENT, { detail }));
  } catch {
    /* no window */
  }
};

export function makeMissionAnswerHandler({ submit = submitMissionAnswer, markDone = markMissionDone, waiting = checkinStillQueued } = {}) {
  return async (job) => {
    const lm = job.payload.landmark;
    if (await waiting(job.uid, lm.id)) return { retry: true, error: 'check-in not synced yet' };
    let out;
    try {
      out = await submit(lm, job.payload.answer);
    } catch (e) {
      const msg = String(e?.userMessage || '');
      // The check-in synced but wasn't verified: the answer can never count.
      if (/check in here first/i.test(msg)) {
        setQueued(job.uid, lm.id, null);
        return { drop: true, notice: `Your mission answer at ${lm.name} didn't count: that check-in wasn't verified.` };
      }
      return { retry: true, error: msg || 'answer' };
    }
    const result = { kind: 'trivia', correct: !!out.correct, picked: Number.isInteger(out.picked) ? out.picked : job.payload.answer, answer: Number.isInteger(out.answer) ? out.answer : null, awarded: Number(out.awarded) || 0 };
    markDone(job.uid, lm.id, result);
    setQueued(job.uid, lm.id, null);
    announce({ uid: job.uid, landmark: lm, result });
    return { done: true };
  };
}

export function registerMissionAnswers(hooks) {
  registerOutboxHandler('missionAnswer', makeMissionAnswerHandler(hooks));
}
