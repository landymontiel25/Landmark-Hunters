// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ALL_LANDMARKS } from '../data/regions';

const fs = vi.hoisted(() => ({ setDoc: vi.fn(), store: new Map() }));
vi.mock('firebase/firestore', async (orig) => ({
  ...(await orig()),
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  setDoc: (...a) => fs.setDoc(...a),
  getDocs: async () => ({ docs: [] }),
  runTransaction: async () => {},
  serverTimestamp: () => 0,
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
}));
vi.mock('../lib/firebase', async (orig) => ({ ...(await orig()), db: {} }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' } }) }));
const shown = vi.hoisted(() => []);
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myProfile: { tagScores: {} } }) }));
vi.mock('../lib/recommendationLog', () => ({ logShownPicks: (a) => { shown.push(a); return Promise.resolve(); } }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: { lat: 40.0356, lng: -75.3437 } }) }));
const solo = vi.hoisted(() => ({ closes: 0, reply: { ok: true, closed: true } }));
vi.mock('../lib/soloStreaks', () => ({ closeSoloToday: () => { solo.closes += 1; return Promise.resolve(solo.reply); } }));
vi.mock('../lib/BadgesContext', () => ({ useBadges: () => ({ reload: () => {}, actionsToday: 0 }) }));
vi.mock('./RateLandmarkSearch', () => ({ default: () => null }));

import MaprPicksCarousel from './MaprPicksCarousel';

let container;
beforeEach(() => {
  fs.setDoc.mockReset();
  fs.setDoc.mockResolvedValue(undefined);
});
afterEach(() => {
  document.body.removeChild(container);
  localStorage.clear();
});

const render = async (props) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <MaprPicksCarousel {...props} />
      </MemoryRouter>
    )
  );
};

describe('Mapr Travel Picks', () => {
  it('fills the row for the nearest city (villanova, given the mocked GPS fix)', async () => {
    await render({ reviews: [], checkedInIds: [] });
    const names = [...container.querySelectorAll('.mapr-pick-name')].map((n) => n.textContent);
    expect(names.length).toBeGreaterThan(0);
    const villanovaLandmarks = ALL_LANDMARKS.filter((l) => l.regionId === 'villanova');
    expect(names.every((n) => villanovaLandmarks.some((l) => l.name === n))).toBe(true);
  });

  it('excludes landmarks already reviewed or checked into', async () => {
    const villanova = ALL_LANDMARKS.filter((l) => l.regionId === 'villanova');
    await render({
      reviews: [{ landmarkId: villanova[0].id }],
      checkedInIds: [villanova[1].id],
    });
    const names = [...container.querySelectorAll('.mapr-pick-name')].map((n) => n.textContent);
    expect(names).not.toContain(villanova[0].name);
    expect(names).not.toContain(villanova[1].name);
  });

  const names = () => [...container.querySelectorAll('.mapr-pick-name')].map((n) => n.textContent);
  const cardBtn = (i, label) => [...container.querySelectorAll('.mapr-pick')[i].querySelectorAll('.pick-vote-btn')].find((b) => b.textContent.includes(label));
  const tap = (el) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

  it('shows the three buttons on each card, with no "ask me again" text', async () => {
    await render({ reviews: [], checkedInIds: [] });
    const first = container.querySelector('.mapr-pick');
    expect([...first.querySelectorAll('.pick-vote-btn')].map((b) => b.textContent.trim())).toEqual(['\u2715 Not for me', '\u{1F937} Not sure', "\u2713 I'd go"]);
    expect(container.textContent.toLowerCase()).not.toContain('ask me again');
  });

  it('Not for me saves to the database (pick_feedback), then removes the card; no modal', async () => {
    await render({ reviews: [], checkedInIds: [] });
    const before = names();
    await tap(cardBtn(0, 'Not for me'));
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = fs.setDoc.mock.calls[0];
    expect(ref.path).toMatch(/^pick_feedback\/me_/);
    expect(data).toMatchObject({ userId: 'me', verdict: 'no' });
    expect(document.querySelector('.modal-card')).toBeFalsy();
    expect(names()).not.toContain(before[0]);
  });

  it("every answer (I'd go, Not sure, Not for me) saves and then takes the card away, because it is answered", async () => {
    await render({ reviews: [], checkedInIds: [] });
    const before = names();
    await tap(cardBtn(0, "I'd go"));
    expect(fs.setDoc.mock.calls[0][1]).toMatchObject({ verdict: 'yes' });
    expect(names()).not.toContain(before[0]);
    const second = names()[0];
    await tap(cardBtn(0, 'Not sure'));
    expect(fs.setDoc.mock.calls[1][1]).toMatchObject({ verdict: 'unsure' });
    expect(names()).not.toContain(second);
  });

  it('nothing changes until the save lands, and a failed save keeps the card and shows Try again', async () => {
    vi.useFakeTimers();
    try {
      fs.setDoc.mockRejectedValue(new Error('down'));
      await render({ reviews: [], checkedInIds: [] });
      const before = names();
      await tap(cardBtn(0, 'Not for me'));
      expect(cardBtn(0, 'Not for me').getAttribute('aria-pressed')).toBe('false');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(fs.setDoc).toHaveBeenCalledTimes(3);
      expect(names()).toEqual(before);
      expect(container.querySelector('[role="alert"]').textContent).toContain("Couldn't save");
      fs.setDoc.mockResolvedValue(undefined);
      await tap(container.querySelector('[role="alert"] button'));
      expect(names()).not.toContain(before[0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets you switch cities from the header button', async () => {
    await render({ reviews: [], checkedInIds: [] });
    const cityButton = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Villanova University'));
    expect(cityButton).toBeTruthy();
    await act(async () => cityButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(document.querySelector('.modal-card')).toBeTruthy();
    expect(document.body.textContent).toContain('Choose a City');
  });
});

describe('Mapr Travel Picks dots', () => {
  it('lights the last dot once you scroll to the end of the row', async () => {
    await render({ reviews: [], checkedInIds: [] });
    const dots = () => [...container.querySelectorAll('.mapr-picks-dot')];
    expect(dots().length).toBeGreaterThan(1);
    const track = container.querySelector('.mapr-picks-track');
    const sizes = { scrollWidth: 2000, clientWidth: 390, scrollLeft: 1610 };
    Object.entries(sizes).forEach(([k, v]) => Object.defineProperty(track, k, { value: v, configurable: true }));
    track.firstElementChild.getBoundingClientRect = () => ({ width: 250 });
    await act(async () => track.dispatchEvent(new Event('scroll')));
    expect(dots().at(-1).classList.contains('active')).toBe(true);
  });

  it('logs each card as a shown Mapr pick (surface travel-picks, set id, rank), once, so votes count toward the taste score', async () => {
    shown.length = 0;
    await render({ reviews: [], checkedInIds: [] });
    expect(shown.length).toBeGreaterThan(0);
    for (const call of shown) {
      expect(call).toMatchObject({ uid: 'me', surface: 'travel-picks', source: 'travel-picks' });
      expect(call.setId).toBeTruthy();
      expect(call.stops).toHaveLength(1);
      expect(call.stops[0]).toMatchObject({ id: expect.any(String), region: expect.any(String), rank: expect.any(Number) });
    }
    const ids = shown.map((c) => c.stops[0].id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(shown.map((c) => c.setId)).size).toBe(1);
  });

  it('shows an N/3 today counter that moves the moment a save lands and turns green (with a check) at 3, then closes the streak day once', async () => {
    solo.closes = 0;
    solo.reply = { ok: true, closed: true };
    await render({ reviews: [], checkedInIds: [] });
    const cardBtn = (i, label) => [...container.querySelectorAll('.mapr-pick')[i].querySelectorAll('.pick-vote-btn')].find((b) => b.textContent.includes(label));
    const tap = (el) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const counter = () => document.querySelector('.pick-day-counter');
    expect(counter().textContent.trim()).toBe('0/3 today');
    expect(counter().className).not.toContain('done');
    await tap(cardBtn(0, "I'd go"));
    expect(counter().textContent.trim()).toBe('1/3 today');
    await tap(cardBtn(0, 'Not sure'));
    await tap(cardBtn(0, 'Not for me'));
    expect(counter().textContent.trim()).toBe('\u2713 3/3 today');
    expect(counter().className).toContain('done');
    expect(solo.closes).toBe(1);
    await tap(cardBtn(0, "I'd go"));
    expect(counter().textContent.trim()).toBe('\u2713 3/3 today');
    expect(solo.closes).toBe(1);
  });

  it('says so on screen, with Try again, when the server does not secure the day', async () => {
    solo.closes = 0;
    solo.reply = { ok: false, error: 'No such streak.' };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await render({ reviews: [], checkedInIds: [] });
    const cardBtn = (i, label) => [...container.querySelectorAll('.mapr-pick')[i].querySelectorAll('.pick-vote-btn')].find((b) => b.textContent.includes(label));
    const tap = (el) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    for (let i = 0; i < 3; i++) await tap(cardBtn(0, "I'd go"));
    const alertEl = container.querySelector('[role="alert"]');
    expect(alertEl.textContent).toContain("Couldn't save today's streak: No such streak.");
    solo.reply = { ok: true, closed: true };
    const retry = [...alertEl.querySelectorAll('button')].find((b) => b.textContent.includes('Try again'));
    await tap(retry);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(solo.closes).toBe(2);
    err.mockRestore();
  });

  it('tells you how many answers the server counted when it did not secure the day', async () => {
    solo.reply = { ok: true, closed: false, counted: 1, needed: 3, window: 'ok' };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await render({ reviews: [], checkedInIds: [] });
    const cardBtn = (i, label) => [...container.querySelectorAll('.mapr-pick')[i].querySelectorAll('.pick-vote-btn')].find((b) => b.textContent.includes(label));
    const tap = (el) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    for (let i = 0; i < 3; i++) await tap(cardBtn(0, "I'd go"));
    expect(container.querySelector('[role="alert"]').textContent).toContain('The server counted 1 of 3 landmarks answered today.');
    err.mockRestore();
  });
});
