// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

const ts = (d) => ({ seconds: Math.floor(new Date(d).getTime() / 1000) });
vi.mock('../lib/leaderboard', () => ({
  getUserCheckins: async () => [
    { id: 'c1', landmarkId: 'a', landmarkName: 'Wynwood Walls', region: 'miami', points: 100, photoURLs: ['old.jpg', 'new.jpg'], createdAt: ts('2026-05-01') },
    { id: 'c2', landmarkId: 'b', landmarkName: 'Liberty Bell', region: 'philly', points: 100, createdAt: ts('2026-06-01') },
    { id: 'c3', landmarkId: 'c', landmarkName: 'Eiffel Tower', region: 'paris', points: 100, createdAt: ts('2026-07-01') },
  ],
  updateCheckinTimestamp: vi.fn(),
  isRealCheckin: () => true,
}));
vi.mock('../lib/reviews', () => ({
  getMyReview: async (uid, id) => (id === 'b' ? { comment: 'Crack was smaller than expected' } : null),
  saveMyComment: vi.fn(),
}));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' } }) }));
vi.mock('../lib/AdminModeContext', () => ({ useAdminMode: () => ({ adminMode: false }) }));

import CheckinsGallery from './CheckinsGallery';

let container;
afterEach(() => document.body.removeChild(container));

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <CheckinsGallery user={{ uid: 'me' }} claimedMap={{}} navigate={() => {}} totalPoints={300} />
      </MemoryRouter>
    )
  );
  await act(async () => new Promise((r) => setTimeout(r, 0)));
}

async function search(value) {
  const input = container.querySelector('.checkin-search');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const names = () => [...container.querySelectorAll('.checkin-name')].map((n) => n.textContent);

describe('My Check-ins search', () => {
  it('filters by place name, city, and your comment', async () => {
    await mount();
    expect(names()).toHaveLength(3);
    await search('eiffel');
    expect(names()).toEqual(['Eiffel Tower']);
    await search('miami');
    expect(names()).toEqual(['Wynwood Walls']);
    await search('crack');
    expect(names()).toEqual(['Liberty Bell']);
    await search('');
    expect(names()).toHaveLength(3);
  });

  it('says so when nothing matches', async () => {
    await mount();
    await search('tokyo');
    expect(names()).toHaveLength(0);
    expect(container.textContent).toContain('No check-ins match "tokyo"');
  });
});

describe('My Check-ins thumbnails', () => {
  it('shows the newest photo added to the check-in, not the stock image', async () => {
    await mount();
    const row = [...container.querySelectorAll('.checkin-row')].find((r) => r.textContent.includes('Wynwood Walls'));
    expect(row.querySelector('img').getAttribute('src')).toBe('new.jpg');
  });
});
