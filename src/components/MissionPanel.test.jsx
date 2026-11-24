// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const checkMissionPhoto = vi.fn(() => ({ ok: false, message: 'nope' }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../lib/leaderboard', () => ({ addCheckinPhoto: vi.fn(async () => 'https://photo') }));
vi.mock('../lib/missionPhoto', () => ({
  checkMissionPhoto: (a) => checkMissionPhoto(a),
  takeMissionPhoto: vi.fn(async () => ({ file: {}, photo: {}, fileTime: Date.now(), device: null })),
}));
const submitMissionPhoto = vi.fn(async () => ({ passed: false, awarded: 0, missing: 'beach', shows: 'marina with boats', why: 'Missing: beach · You took: marina with boats' }));
vi.mock('../lib/missions', async (orig) => ({ ...(await orig()), loadServerMission: async () => null, submitMissionPhoto: (...a) => submitMissionPhoto(...a) }));

const landmark = { id: 'abaco-beach-resort', name: 'Resort', region: 'abacos', mission: { type: 'photo', text: 'Photograph the marina.' } };
// The photo check runs in the background through the outbox (owner, 2026-11-24).
const outbox = await import('../lib/outbox');
const { registerMissionPhotos } = await import('../lib/missionPhotoQueue');
const settle = () => act(async () => {
  await outbox.flushOutbox('u1');
  await new Promise((r) => setTimeout(r, 0));
});

const roots = [];
async function render(props) {
  const { default: MissionPanel } = await import('./MissionPanel.jsx');
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  await act(async () => root.render(<MissionPanel landmark={landmark} {...props} />));
  return el;
}

describe('MissionPanel start (owner, 2026-11-23)', () => {
  beforeEach(async () => {
    // Panels from earlier tests would hear this test's results too.
    while (roots.length) {
      const { root, el } = roots.pop();
      await act(async () => root.unmount());
      el.remove();
    }
    document.querySelectorAll('.mc-overlay').forEach((n) => n.remove());
    outbox._resetOutboxForTests();
    registerMissionPhotos();
    localStorage.clear();
  });
  it('already checked in on an earlier day: straight to the photo button, no check-in prompt', async () => {
    const el = await render({ checkedInAt: null, checkedIn: true });
    expect(el.textContent).not.toMatch(/Check in here/);
    const btn = [...el.querySelectorAll('button')].find((b) => /Take mission photo/.test(b.textContent));
    expect(btn).toBeTruthy();
    const before = Date.now();
    await act(async () => btn.click());
    // The visit starts at the tap: the photo has to be taken from then on.
    expect(checkMissionPhoto.mock.calls[0][0].checkedInAt).toBeGreaterThanOrEqual(before);
  });
  it('checked in today: the photo is checked against that check-in', async () => {
    checkMissionPhoto.mockClear();
    const el = await render({ checkedInAt: 1234, checkedIn: true });
    const btn = [...el.querySelectorAll('button')].find((b) => /Take mission photo/.test(b.textContent));
    await act(async () => btn.click());
    expect(checkMissionPhoto.mock.calls[0][0].checkedInAt).toBe(1234);
  });
  it('never checked in: says to check in, no photo button', async () => {
    const el = await render({});
    expect(el.textContent).toMatch(/Check in here to start it/);
    expect([...el.querySelectorAll('button')].some((b) => /mission photo/.test(b.textContent))).toBe(false);
  });
  it('a refused photo shows two short bullets, nothing else (owner, 2026-11-23)', async () => {
    checkMissionPhoto.mockImplementation(() => ({ ok: true }));
    const el = await render({ checkedInAt: null, checkedIn: true });
    const btn = [...el.querySelectorAll('button')].find((b) => /Take mission photo/.test(b.textContent));
    await act(async () => btn.click());
    await settle();
    const items = [...el.querySelectorAll('ul.mission-note li')].map((li) => li.textContent);
    expect(items).toEqual(['Missing: beach', 'You took: marina with boats']);
    expect(el.textContent).not.toMatch(/Retake it:/);
  });
  it('a finished photo mission plays "Mission completed" with its points, then reads Mission completed', async () => {
    checkMissionPhoto.mockImplementation(() => ({ ok: true }));
    submitMissionPhoto.mockImplementationOnce(async () => ({ passed: true, awarded: 10 }));
    const el = await render({ checkedInAt: null, checkedIn: true });
    const btn = [...el.querySelectorAll('button')].find((b) => /Take mission photo/.test(b.textContent));
    await act(async () => btn.click());
    await settle();
    const overlay = document.body.querySelector('.mc-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('Mission completed');
    expect(overlay.textContent).toContain('+10 points');
    expect(overlay.textContent).toContain('Resort');
    expect(el.textContent).toContain('Mission completed. +10 points.');
    await act(async () => overlay.click());
    expect(document.body.querySelector('.mc-overlay')).toBeNull();
  });
  it('says it is checking and lets you move on; the check finishes and pays after the panel closes', async () => {
    checkMissionPhoto.mockImplementation(() => ({ ok: true }));
    let release;
    submitMissionPhoto.mockImplementationOnce(() => new Promise((r) => (release = () => r({ passed: true, awarded: 10 }))));
    const el = await render({ checkedInAt: null, checkedIn: true });
    const btn = [...el.querySelectorAll('button')].find((b) => /Take mission photo/.test(b.textContent));
    await act(async () => btn.click());
    expect(el.textContent).toMatch(/Checking your photo\. You can tap Done and keep going/);
    // Done: the panel goes away before the check answers.
    el.remove();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      release();
      await outbox.flushOutbox('u1');
    });
    const { missionDone } = await import('../lib/missions');
    expect(missionDone('u1', landmark.id)).toMatchObject({ kind: 'photo', awarded: 10 });
  });
});
