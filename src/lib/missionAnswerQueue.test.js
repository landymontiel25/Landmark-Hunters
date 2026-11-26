// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { missionFor, makeMissionAnswerHandler, queueMissionAnswer, queuedMissionAnswer, checkinStillQueued, MISSION_RESULT_EVENT } from './missionAnswerQueue';
import { makeMissionPhotoHandler } from './missionPhotoQueue';
import { _resetOutboxForTests, putJob, listJobs } from './outbox';
import { getLandmark } from '../data/regions';

const boat = { id: 'albury-brothers-boatbuilding', region: 'abacos', name: "Albury Brothers' boatbuilding heritage" };
const job = (answer = 1) => ({ id: 'j1', uid: 'u1', kind: 'missionAnswer', payload: { landmark: boat, answer } });

beforeEach(() => {
  _resetOutboxForTests();
  localStorage.clear();
});

describe('offline missions (owner, 2026-11-25)', () => {
  it('the mission is on the phone: it ships with the app, even when the object at hand lacks it', () => {
    const m = missionFor(boat);
    expect(m?.type).toBe('trivia');
    expect(m.options).toHaveLength(4);
    // The right answer is never in the app's data.
    expect(getLandmark('abacos', boat.id).mission.answer).toBeUndefined();
    expect(missionFor({ id: 'nowhere', region: 'abacos', name: 'X' })).toBeNull();
  });

  it('an answer given offline is saved on the phone, in the outbox', async () => {
    await queueMissionAnswer({ uid: 'u1', landmark: boat, answer: 2 });
    const jobs = await listJobs('u1', 'missionAnswer');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ answer: 2, landmark: { id: boat.id } });
    expect(queuedMissionAnswer('u1', boat.id)).toMatchObject({ picked: 2 });
  });

  it('waits while its offline check-in has not synced', async () => {
    await putJob({ uid: 'u1', kind: 'checkin', payload: { landmarkId: boat.id } });
    expect(await checkinStillQueued('u1', boat.id)).toBe(true);
    expect(await checkinStillQueued('u1', 'other')).toBe(false);
    const submit = vi.fn();
    const out = await makeMissionAnswerHandler({ submit })(job());
    expect(out.retry).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });

  it('once synced, the server decides; the result (with the right answer) goes to the result screen', async () => {
    const heard = [];
    window.addEventListener(MISSION_RESULT_EVENT, (e) => heard.push(e.detail));
    const submit = vi.fn(async () => ({ ok: true, correct: false, awarded: 0, picked: 0, answer: 1 }));
    const markDone = vi.fn();
    const out = await makeMissionAnswerHandler({ submit, markDone, waiting: async () => false })(job(0));
    expect(out.done).toBe(true);
    expect(submit).toHaveBeenCalledWith(boat, 0);
    expect(markDone).toHaveBeenCalledWith('u1', boat.id, expect.objectContaining({ correct: false, picked: 0, answer: 1 }));
    expect(heard.at(-1)).toMatchObject({ uid: 'u1', landmark: { id: boat.id }, result: { correct: false, picked: 0, answer: 1 } });
  });

  it('a network or server error keeps it waiting, quietly', async () => {
    const out = await makeMissionAnswerHandler({ submit: async () => { throw Object.assign(new Error('x'), { userMessage: "Couldn't check your answer. Try again." }); }, waiting: async () => false })(job());
    expect(out).toMatchObject({ retry: true });
    expect(out.notice).toBeUndefined();
  });

  it('an answer whose check-in was not verified is dropped with a plain word why', async () => {
    const out = await makeMissionAnswerHandler({ submit: async () => { throw Object.assign(new Error('x'), { userMessage: 'Check in here first, then answer.' }); }, waiting: async () => false })(job());
    expect(out.drop).toBe(true);
    expect(out.notice).toMatch(/wasn't verified/);
  });

  it('a mission photo taken offline also waits for its check-in', async () => {
    const upload = vi.fn();
    const out = await makeMissionPhotoHandler({ upload, waiting: async () => true })({ id: 'p', uid: 'u1', payload: { landmark: boat }, files: [new Blob(['x'])] });
    expect(out.retry).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });
});
