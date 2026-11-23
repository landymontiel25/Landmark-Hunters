// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../lib/leaderboard', () => ({ addCheckinPhoto: vi.fn() }));
vi.mock('../lib/missionPhoto', () => ({ checkMissionPhoto: vi.fn(), takeMissionPhoto: vi.fn() }));
let server = null;
const submitMissionAnswer = vi.fn();
vi.mock('../lib/missions', async (orig) => ({ ...(await orig()), loadServerMission: async () => server, submitMissionAnswer: (...a) => submitMissionAnswer(...a) }));

const landmark = { id: 'x', name: 'Place', region: 'abacos', mission: { type: 'trivia', text: 'Answer.', question: 'Which?', options: ['A', 'B', 'C', 'D'] } };

async function render() {
  localStorage.clear();
  const { default: MissionPanel } = await import('./MissionPanel.jsx');
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(<MissionPanel landmark={landmark} checkedIn />));
  return el;
}
const opts = (el) => [...el.querySelectorAll('.mission-option')];

describe('trivia answer feedback (owner, 2026-11-23)', () => {
  it('the right answer turns green', async () => {
    server = null;
    submitMissionAnswer.mockResolvedValue({ correct: true, awarded: 10, answer: 2, picked: 2 });
    const el = await render();
    await act(async () => opts(el)[2].click());
    expect(opts(el).map((b) => b.className.includes('is-right'))).toEqual([false, false, true, false]);
    expect(el.querySelector('.is-wrong')).toBeNull();
  });
  it('a wrong answer turns red and shows the right one in green', async () => {
    server = null;
    submitMissionAnswer.mockResolvedValue({ correct: false, awarded: 0, answer: 1, picked: 3 });
    const el = await render();
    await act(async () => opts(el)[3].click());
    expect(opts(el)[3].className).toContain('is-wrong');
    expect(opts(el)[1].className).toContain('is-right');
    expect(el.textContent).toContain('The right answer: B');
    expect(opts(el).every((b) => b.disabled)).toBe(true);
  });
  it('nothing shows before you answer', async () => {
    server = null;
    const el = await render();
    expect(el.querySelector('.is-right, .is-wrong')).toBeNull();
    expect(el.textContent).not.toMatch(/right answer/i);
  });
  it('an older wrong answer fetches the right one once', async () => {
    server = { kind: 'trivia', correct: false, picked: 0, answer: null };
    submitMissionAnswer.mockResolvedValue({ correct: false, answer: 3, picked: 0, reason: 'already' });
    const el = await render();
    expect(submitMissionAnswer).toHaveBeenCalledWith(landmark, 0);
    expect(opts(el)[0].className).toContain('is-wrong');
    expect(opts(el)[3].className).toContain('is-right');
  });
});
