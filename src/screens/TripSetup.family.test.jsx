// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Owner, 2026-11-16: "Group" is "Family Sharing" in the Plan step, and a
// Family Sharing trip needs at least one person besides you.
let container;
afterEach(() => {
  localStorage.clear();
  container?.remove();
  vi.resetModules();
});

const created = vi.fn(async () => 'trip-1');
// One user object, like the real AuthContext: a new one each render would
// re-run the friends effect forever.
const ME = { uid: 'me', displayName: 'Me' };
const AUTH = { user: ME };
const FRIENDS = { myUsername: 'me', friendsKnown: true, friendUids: new Set() };

async function render() {
  vi.doMock('../lib/TripContext', () => ({
    useTrip: () => {
      const [trip, setTrip] = useState({ interests: [], customInterests: [], customInterestEmoji: {}, savedInterests: [], savedCustomInterests: [], activeRegion: 'miami', startingLocation: '' });
      return { trip, updateTrip: (p) => setTrip((t) => ({ ...t, ...p })), setCustomInterestMatches: vi.fn(), setCustomInterestEmoji: vi.fn(), removeCustomInterest: vi.fn() };
    },
  }));
  vi.doMock('../lib/useGpsStartLocation', () => ({ useGpsStartLocation: () => ({ useCurrentLocation: vi.fn(), locating: false, usingGps: false }) }));
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => AUTH }));
  vi.doMock('../lib/FriendsContext', () => ({ useFriends: () => FRIENDS }));
  vi.doMock('../lib/friends', () => ({ listFriends: async () => [] }));
  vi.doMock('../lib/groupTrips', () => ({ createGroupTrip: (...a) => created(...a), MAX_GROUP_MEMBERS: 8 }));
  vi.doMock('../components/AddMemberSheet', () => ({
    default: ({ onPick }) => (
      <button type="button" className="pick-ana" onClick={() => onPick({ uid: 'ana', name: 'Ana' })}>
        pick Ana
      </button>
    ),
  }));
  vi.doMock('../components/LocationAutocomplete', () => ({ default: () => null, HomeStartPrefill: () => null }));
  vi.doMock('../components/RegionSearch', () => ({ default: () => null }));
  const { default: TripSetup } = await import('./TripSetup.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <TripSetup />
      </MemoryRouter>,
    ),
  );
  return container;
}
const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));

describe('Plan: Family Sharing', () => {
  it('says Family Sharing, never Group, and needs at least one person before it starts', async () => {
    const el = await render();
    await click(button(el, 'Plan'));
    expect([...el.querySelectorAll('.tab-btn')].map((b) => b.textContent)).toEqual(expect.arrayContaining(['\u{1F464} Solo', '\u{1F465} Family Sharing']));
    expect(el.textContent).not.toMatch(/\bGroup\b/);
    await click(button(el, 'Family Sharing'));
    expect(el.textContent).not.toMatch(/\bgroup\b/i);
    const start = button(el, 'Start Family Sharing Trip');
    expect(start.disabled).toBe(true);
    expect(el.querySelector('.family-need').textContent).toBe('Add at least one person to share this trip with.');
    await click(button(el, 'Add a person'));
    await click(el.querySelector('.pick-ana'));
    expect(el.textContent).toContain('Ana');
    expect(el.querySelector('.family-need')).toBeNull();
    expect(button(el, 'Start Family Sharing Trip').disabled).toBe(false);
    await click(button(el, 'Start Family Sharing Trip'));
    expect(created).toHaveBeenCalledOnce();
    expect(created.mock.calls[0][0].initialMembers).toEqual([{ uid: 'ana', name: 'Ana' }]);
  });

  it('Solo needs no one', async () => {
    const el = await render();
    await click(button(el, 'Plan'));
    await click(button(el, 'Solo'));
    expect(el.querySelector('.family-need')).toBeNull();
    expect(button(el, 'Choose Landmarks').disabled).toBe(false);
  });
});
