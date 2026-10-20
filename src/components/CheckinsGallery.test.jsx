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

async function mount(totalPoints = 300, layout = 'list') {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <CheckinsGallery user={{ uid: 'me' }} claimedMap={{}} navigate={() => {}} totalPoints={totalPoints} initialLayout={layout} />
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

describe('My Check-ins total points', () => {
  const pts = () => container.querySelector('.rank-hero-pts').textContent;

  it('shows the total once it is known', async () => {
    await mount(300);
    expect(pts()).toContain('300 total points');
  });

  it('shows a placeholder, not 0, while stats are still loading', async () => {
    await mount(null);
    expect(pts()).not.toMatch(/\d/);
    expect(container.querySelector('.rank-hero-pts .skeleton-inline')).not.toBeNull();
  });

  it("shows a dash, not 0, when stats couldn't load", async () => {
    await mount('–');
    expect(pts()).toContain('– total points');
  });
});

// Owner, 2026-10-18: organize check-ins by city, a fold-out per city with a search.
describe('My Check-ins by city', () => {
  it('groups check-ins into one fold-out per city, each with its own search', async () => {
    await mount();
    const select = container.querySelector('select');
    await act(async () => {
      select.value = 'city';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const heads = [...container.querySelectorAll('.checkin-city-head')].map((h) => h.textContent);
    expect(heads.length).toBe(3);
    expect(names()).toHaveLength(0); // all folded
    const miami = [...container.querySelectorAll('.checkin-city')].find((d) => d.textContent.includes('Miami'));
    await act(async () => {
      miami.open = true;
      miami.dispatchEvent(new Event('toggle'));
    });
    expect(names()).toEqual(['Wynwood Walls']);
    expect(miami.querySelector('input[type="search"]')).toBeTruthy();
    localStorage.removeItem('lh-checkins-sort');
  });
});

// Owner, 2026-10-20: My Memories opens on Grid.
describe('My Memories default view', () => {
  it('starts on Grid', async () => {
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
    expect(container.querySelectorAll('.checkin-tile')).toHaveLength(3);
    expect(container.querySelector('.checkin-row')).toBeNull();
  });
});
