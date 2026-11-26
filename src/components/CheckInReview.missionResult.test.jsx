// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// A trivia place, like Albury's Brothers Boat Building Heritage.
const landmark = { id: 'boat', name: 'Boat Building Heritage', region: 'abacos', categories: ['history-culture'], mission: { type: 'trivia', text: 'Answer it.', question: 'Which family?', options: ['Smith', 'Albury', 'Russell', 'Malone'] } };
const cleared = vi.fn();
const checkInState = {
  justCheckedIn: landmark,
  checkInOptions: { ratingOnly: false, requireComment: false },
  celebration: { points: 0 },
  claimedMap: { boat: true },
  commitCheckIn: async () => ({ claimed: true, checkinId: 'me_boat' }),
  clearJustCheckedIn: () => cleared(),
  presenceResult: null,
};
const authState = { user: { uid: 'me', emailVerified: true } };
vi.mock('../lib/useCheckIn', () => ({ useCheckIn: () => checkInState }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me' }) }));
vi.mock('../lib/RatingsContext', () => ({ useRatings: () => ({ myReviews: { boat: { ratingTier: 'highly-recommend', comment: '', highlights: [] } }, reload: () => {} }) }));
vi.mock('../lib/MyPhotosContext', () => ({ useMyPhotos: () => ({ reload: () => {} }) }));
vi.mock('../lib/reviews', () => ({ submitReview: vi.fn(async () => ({})), ratingDraftKey: () => null }));
vi.mock('../lib/leaderboard', () => ({ attachCheckinPhoto: vi.fn(), addCheckinPhoto: vi.fn() }));
vi.mock('../lib/imageUtils', () => ({ pickPhoto: vi.fn() }));
vi.mock('../lib/tipCheckin', () => ({ hasMyTip: async () => false }));
vi.mock('./MissionComplete', () => ({ default: () => null }));
vi.mock('./CheckInBlast', async () => {
  const { useEffect } = await import('react');
  return {
    default: function FakeBlast({ onDone }) {
      useEffect(() => onDone(), [onDone]);
      return null;
    },
  };
});
const answerResult = { current: null };
vi.mock('../lib/missions', async (orig) => ({
  ...(await orig()),
  loadServerMission: async () => null,
  submitMissionAnswer: () => answerResult.current,
}));

import CheckInReview from './CheckInReview';

const buttons = (c) => [...c.querySelectorAll('button')];
const byText = (c, t) => buttons(c).find((b) => b.textContent.trim() === t);
async function postCheckIn() {
  localStorage.clear();
  cleared.mockClear();
  const c = document.createElement('div');
  document.body.appendChild(c);
  await act(async () => createRoot(c).render(<CheckInReview />));
  await act(async () => byText(c, 'Post').click());
  await act(async () => {});
  return c;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('trivia mission result after Done (owner, 2026-11-25)', () => {
  it('the mission still shows right after the check-in', async () => {
    const c = await postCheckIn();
    expect(c.textContent).toContain('Which family?');
  });

  it('a wrong answer: Done shows the result with the right answer, and only the second Done closes', async () => {
    answerResult.current = Promise.resolve({ ok: true, correct: false, awarded: 0, picked: 0, answer: 1 });
    const c = await postCheckIn();
    await act(async () => byText(c, 'Smith').click());
    await act(async () => {});
    // Red right away in the panel.
    expect(buttons(c).find((b) => b.textContent.startsWith('Smith')).className).toContain('is-wrong');
    await act(async () => byText(c, 'Done').click());
    expect(cleared).not.toHaveBeenCalled();
    const screen = c.querySelector('.mission-result-screen');
    expect(screen).toBeTruthy();
    expect(screen.textContent).toContain('Not this time');
    expect(screen.textContent).toContain('The answer: Albury');
    const opts = [...screen.querySelectorAll('.mission-option')];
    expect(opts[0].className).toContain('is-wrong');
    expect(opts[1].className).toContain('is-right');
    await act(async () => byText(c, 'Done').click());
    expect(cleared).toHaveBeenCalledOnce();
  });

  it('a right answer: Done shows "You got it right" with the points, then Done closes', async () => {
    answerResult.current = Promise.resolve({ ok: true, correct: true, awarded: 10, picked: 1, answer: 1 });
    const c = await postCheckIn();
    await act(async () => byText(c, 'Albury').click());
    await act(async () => {});
    await act(async () => byText(c, 'Done').click());
    const screen = c.querySelector('.mission-result-screen');
    expect(screen.textContent).toContain('You got it right');
    expect(screen.textContent).toContain('+10 points.');
    expect(screen.textContent).toContain('The answer: Albury');
    expect(screen.querySelector('.is-wrong')).toBeNull();
    expect(cleared).not.toHaveBeenCalled();
    await act(async () => byText(c, 'Done').click());
    expect(cleared).toHaveBeenCalledOnce();
  });

  it('Done tapped while the answer is still being checked waits for it, then shows the result', async () => {
    let resolve;
    answerResult.current = new Promise((r) => (resolve = r));
    const c = await postCheckIn();
    await act(async () => byText(c, 'Smith').click());
    await act(async () => byText(c, 'Done').click());
    expect(cleared).not.toHaveBeenCalled();
    await act(async () => resolve({ ok: true, correct: false, awarded: 0, picked: 0, answer: 1 }));
    await act(async () => {});
    expect(c.querySelector('.mission-result-screen').textContent).toContain('The answer: Albury');
    expect(cleared).not.toHaveBeenCalled();
  });

  it('no answer given: Done closes as before', async () => {
    const c = await postCheckIn();
    await act(async () => byText(c, 'Done').click());
    expect(cleared).toHaveBeenCalledOnce();
  });
});
