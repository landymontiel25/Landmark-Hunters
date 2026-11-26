// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../lib/leaderboard', () => ({ addCheckinPhoto: vi.fn() }));
vi.mock('../lib/missionPhoto', () => ({ checkMissionPhoto: vi.fn(), takeMissionPhoto: vi.fn() }));
vi.mock('./MissionComplete', () => ({ default: () => null }));
const submitMissionAnswer = vi.fn();
vi.mock('../lib/missions', async (orig) => ({ ...(await orig()), loadServerMission: async () => null, submitMissionAnswer: (...a) => submitMissionAnswer(...a) }));

import MissionPanel from './MissionPanel';
import MissionResultSync from './MissionResultSync';
import { MISSION_RESULT_EVENT } from '../lib/missionAnswerQueue';
import { OFFLINE_CHECKIN_SYNCED_EVENT } from '../lib/offlineCheckins';
import { _resetOutboxForTests, listJobs } from '../lib/outbox';

const boat = { id: 'albury-brothers-boatbuilding', region: 'abacos', regionId: 'abacos', name: "Albury Brothers' boatbuilding heritage" };
const mount = async (node) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(node));
  return el;
};
const fire = (name, detail, target = window) => act(async () => target.dispatchEvent(new CustomEvent(name, { detail })));
const opts = (el) => [...el.querySelectorAll('.mission-option')];

beforeEach(() => {
  localStorage.clear();
  _resetOutboxForTests();
  document.body.innerHTML = '';
  submitMissionAnswer.mockReset();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('the mission after an offline check-in (owner, 2026-11-25)', () => {
  it('shows right away, and an answer is saved on the phone (nothing sent, nothing revealed)', async () => {
    // A landmark object without its mission, like one from a list: the app's own data fills it in.
    const el = await mount(<MissionPanel landmark={boat} checkedInAt={Date.now()} offline />);
    expect(el.textContent).toContain(opts(el)[0].textContent);
    expect(opts(el)).toHaveLength(4);
    await act(async () => opts(el)[2].click());
    expect(submitMissionAnswer).not.toHaveBeenCalled();
    expect(opts(el)[2].className).toContain('is-picked');
    expect(el.querySelector('.is-right, .is-wrong')).toBeNull();
    expect(el.textContent).toContain("Your answer's saved on this phone");
    expect(opts(el).every((b) => b.disabled)).toBe(true);
    expect(await listJobs('u1', 'missionAnswer')).toHaveLength(1);
  });

  it('when the answer is checked on sync, the panel and the result screen show right or wrong and the right answer', async () => {
    const panel = await mount(<MissionPanel landmark={boat} checkedInAt={Date.now()} offline />);
    const sheet = await mount(<MissionResultSync />);
    await act(async () => opts(panel)[0].click());
    await fire(MISSION_RESULT_EVENT, { uid: 'u1', landmark: boat, result: { kind: 'trivia', correct: false, picked: 0, answer: 1, awarded: 0 } });
    expect(opts(panel)[0].className).toContain('is-wrong');
    expect(opts(panel)[1].className).toContain('is-right');
    const screen = sheet.querySelector('.mission-result-screen');
    expect(screen.textContent).toContain('Not this time');
    expect(screen.textContent).toMatch(/The answer: /);
    const done = [...sheet.querySelectorAll('button')].find((b) => b.textContent === 'Done');
    await act(async () => done.click());
    expect(sheet.querySelector('.mission-result-screen')).toBeNull();
  });

  it('a right answer on sync shows "You got it right" with the points', async () => {
    const sheet = await mount(<MissionResultSync />);
    await fire(MISSION_RESULT_EVENT, { uid: 'u1', landmark: boat, result: { kind: 'trivia', correct: true, picked: 1, answer: 1, awarded: 10 } });
    expect(sheet.textContent).toContain('You got it right');
    expect(sheet.textContent).toContain('+10 points.');
  });

  it('a check-in that synced with its mission not done offline offers the mission then', async () => {
    const sheet = await mount(<MissionResultSync />);
    await fire(OFFLINE_CHECKIN_SYNCED_EVENT, { landmarkId: boat.id, landmarkName: boat.name, region: 'abacos', saved: true, verified: true, awarded: 0 });
    expect(sheet.textContent).toContain(`Your mission at ${boat.name}`);
    expect(opts(sheet)).toHaveLength(4);
    // Answered there and then (online now): Done shows the result screen, the next Done closes.
    submitMissionAnswer.mockResolvedValue({ ok: true, correct: true, awarded: 10, picked: 1, answer: 1 });
    await act(async () => opts(sheet)[1].click());
    await act(async () => [...sheet.querySelectorAll('button')].find((b) => b.textContent === 'Done').click());
    expect(sheet.querySelector('.mission-result-screen').textContent).toContain('You got it right');
    await act(async () => [...sheet.querySelectorAll('button')].find((b) => b.textContent === 'Done').click());
    expect(sheet.querySelector('.modal-card')).toBeNull();
  });

  it("doesn't offer it when the answer was already given offline, the check-in wasn't verified, or the place has no mission", async () => {
    localStorage.setItem(`lh.missionAnswer.u1.${boat.id}`, JSON.stringify({ picked: 0 }));
    const sheet = await mount(<MissionResultSync />);
    await fire(OFFLINE_CHECKIN_SYNCED_EVENT, { landmarkId: boat.id, landmarkName: boat.name, region: 'abacos', saved: true, verified: true });
    localStorage.clear();
    await fire(OFFLINE_CHECKIN_SYNCED_EVENT, { landmarkId: boat.id, landmarkName: boat.name, region: 'abacos', saved: true, verified: false });
    await fire(OFFLINE_CHECKIN_SYNCED_EVENT, { landmarkId: 'no-such-place', landmarkName: 'Nowhere', region: 'abacos', saved: true, verified: true });
    expect(sheet.querySelector('.modal-card')).toBeNull();
  });
});
