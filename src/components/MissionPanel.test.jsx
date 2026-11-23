// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const checkMissionPhoto = vi.fn(() => ({ ok: false, message: 'nope' }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../lib/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('../lib/leaderboard', () => ({ addCheckinPhoto: vi.fn() }));
vi.mock('../lib/missionPhoto', () => ({
  checkMissionPhoto: (a) => checkMissionPhoto(a),
  takeMissionPhoto: vi.fn(async () => ({ file: {}, photo: {}, fileTime: Date.now(), device: null })),
}));
vi.mock('../lib/missions', async (orig) => ({ ...(await orig()), loadServerMission: async () => null }));

const landmark = { id: 'abaco-beach-resort', name: 'Resort', region: 'abacos', mission: { type: 'photo', text: 'Photograph the marina.' } };

async function render(props) {
  const { default: MissionPanel } = await import('./MissionPanel.jsx');
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(<MissionPanel landmark={landmark} {...props} />));
  return el;
}

describe('MissionPanel start (owner, 2026-11-23)', () => {
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
});
