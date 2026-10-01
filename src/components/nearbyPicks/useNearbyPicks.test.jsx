// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { getRegion } from '../../data/regions';
import { nearbyPicksCacheKey, pickKey, withinDistance, writeNearbyPicksCache } from '../../lib/nearbyPicks';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/pickReasonsApi', () => ({ fetchPickReasons: vi.fn(async () => ({})) }));
vi.mock('../../lib/recommendationLog', () => ({ logRecommendations: vi.fn(async () => []) }));

import { useNearbyPicks } from './useNearbyPicks';

// Photos load on the next tick, except any URL listed in `stuck` (never
// answers: "still loading") or `broken` (fails).
const stuck = new Set();
const broken = new Set();
class FakeImage {
  set src(url) {
    this._src = url;
    setTimeout(() => {
      if (stuck.has(url)) return;
      if (broken.has(url)) this.onerror?.();
      else this.onload?.();
    }, 0);
  }
  get src() {
    return this._src;
  }
}

const ORIGIN = getRegion('villanova').center;
const NOW = Date.now();
const PROFILE = {
  tagScores: { villanova: { 'history-culture': 40, food: 20 } },
  tagScoresAt: { villanova: { 'history-culture': NOW, food: NOW } },
  tagCounts: { villanova: { 'history-culture': 8, food: 5 } },
};
const REVIEWS = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`r${i}`, { landmarkId: `r${i}`, ratingTier: 'worth-trying' }])
);

let container;
let root;
let latest;
function Probe(props) {
  latest = useNearbyPicks(props);
  return null;
}
const render = async (props) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Probe {...props} />));
};
const flush = async (ms = 150) => act(async () => new Promise((r) => setTimeout(r, ms)));
const base = (extra = {}) => ({
  uid: 'u1',
  profile: PROFILE,
  origin: ORIGIN,
  miles: 10,
  myReviews: REVIEWS,
  checkinCounts: {},
  links: [],
  lastCategory: null,
  now: NOW,
  ...extra,
});

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
  stuck.clear();
  broken.clear();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useNearbyPicks', () => {
  it('fillNew keeps a "Something new" place in the set when every category has been rated a lot, and saves it apart from the real Map', async () => {
    const allRated = {
      tagScores: PROFILE.tagScores,
      tagScoresAt: PROFILE.tagScoresAt,
      tagCounts: { villanova: Object.fromEntries(['history-culture', 'food', 'art-museums', 'parks-nature', 'campus-life', 'local-life', 'entertainment', 'tech', 'stadiums', 'sports'].map((c) => [c, 99])) },
    };
    await render(base({ profile: allRated, fillNew: true, fetchReasons: vi.fn(async () => ({})) }));
    await flush(250);
    expect(latest.picks.some((p) => p.pickType === 'new')).toBe(true);
    const saved = Object.keys(localStorage).filter((k) => k.startsWith('lh-nearby-picks') || k.includes('picks'));
    expect(saved.some((k) => k.endsWith(':test'))).toBe(true);
    expect(saved.some((k) => !k.endsWith(':test') && k.includes('nearby'))).toBe(false);
  });

  it('showDifferent builds a new set that skips the places that were showing', async () => {
    await render(base({ fetchReasons: vi.fn(async () => ({})) }));
    await flush();
    const before = latest.picks.map(pickKey);
    expect(before).toHaveLength(4);
    expect(latest.refreshing).toBe(false);

    await act(async () => latest.showDifferent());
    await flush(120);

    expect(latest.refreshing).toBe(false);
    const after = latest.picks.map(pickKey);
    expect(after).toHaveLength(4);
    expect(after.filter((k) => before.includes(k))).toEqual([]);
  });

  it('puts a place you loved within a mile first, tagged as a favorite', async () => {
    const lovedPlace = withinDistance(getRegion('villanova').landmarks, ORIGIN, 1).find((l) => l.distanceMeters > 150);
    expect(lovedPlace).toBeTruthy();
    const myReviews = { ...REVIEWS, [lovedPlace.id]: { landmarkId: lovedPlace.id, ratingTier: 'highly-recommend' } };
    await render(base({ myReviews, fetchReasons: vi.fn(async () => ({})) }));
    await flush();
    expect(latest.picks[0]).toMatchObject({ id: lovedPlace.id, favorite: true });
    expect(latest.picks[0].reason).toMatch(/^You loved this place\./);
    // Still a full set with exactly one "something new" in it.
    expect(latest.picks).toHaveLength(4);
    expect(latest.picks.filter((p) => p.pickType === 'new')).toHaveLength(1);
  });

  it('shows plain fallback reasons when the reasons call fails, and logs the picks as real usage', async () => {
    const fetchReasons = vi.fn(async () => {
      throw new Error('network down');
    });
    const logPicks = vi.fn(async () => []);
    await render(base({ fetchReasons, logPicks }));
    expect(latest.picks).toBeNull(); // first load: skeletons, no cards yet
    await flush();

    expect(latest.picks).toHaveLength(4);
    expect(latest.picks.every((p) => p.reasonSource === 'fallback' && p.reason)).toBe(true);
    expect(latest.picks.filter((p) => p.pickType === 'new')).toHaveLength(1);
    expect(fetchReasons).toHaveBeenCalledTimes(1);
    expect(logPicks).toHaveBeenCalledTimes(1);
    expect(logPicks.mock.calls[0][0]).toMatchObject({ uid: 'u1', source: 'map-picks', isTest: false });
  });

  it('uses the AI line where the one call returned one', async () => {
    const fetchReasons = vi.fn(async (picks) => ({ [pickKey(picks[0])]: 'A quiet stone church at the heart of campus.' }));
    await render(base({ fetchReasons, logPicks: vi.fn() }));
    await flush();
    expect(latest.picks[0]).toMatchObject({ reason: 'A quiet stone church at the heart of campus.', reasonSource: 'ai' });
    expect(latest.picks.slice(1).every((p) => p.reasonSource === 'fallback')).toBe(true);
  });

  it('skips a pick whose photo is still loading and shows the next one', async () => {
    // First, what the set looks like with every photo loading fine.
    await render(base({ fetchReasons: vi.fn(async () => ({})), logPicks: vi.fn() }));
    await flush();
    const normal = latest.picks.map(pickKey);
    const first = latest.picks[0];
    await act(async () => root.unmount());
    localStorage.clear();

    stuck.add(first.image);
    await render(base({ fetchReasons: vi.fn(async () => ({})), logPicks: vi.fn(), uid: 'u2' }));
    // Photos answer on the next tick; the stuck one never does, so wait out the photo wait.
    await flush(3200);
    const keys = latest.picks.map(pickKey);
    expect(keys).not.toContain(pickKey(first));
    expect(keys).toHaveLength(4);
    expect(keys).toContain(normal[1]);
  }, 10_000);

  it('shows a fresh cached set without calling anything', async () => {
    const key = nearbyPicksCacheKey({ uid: 'u1', ratingsCount: 10, origin: ORIGIN, miles: 10, lastCategory: null });
    writeNearbyPicksCache(key, [{ id: 'cached', region: 'villanova', name: 'Cached', image: 'https://x/y.jpg' }], NOW - 60_000);
    const fetchReasons = vi.fn(async () => ({}));
    await render(base({ fetchReasons, logPicks: vi.fn() }));
    await flush();
    expect(latest.picks.map((p) => p.id)).toEqual(['cached']);
    expect(latest.updating).toBe(false);
    expect(fetchReasons).not.toHaveBeenCalled();
  });

  it('keeps an old cached set on screen with "Updating…" until the new set arrives', async () => {
    const key = nearbyPicksCacheKey({ uid: 'u1', ratingsCount: 10, origin: ORIGIN, miles: 10, lastCategory: null });
    writeNearbyPicksCache(key, [{ id: 'old', region: 'villanova', name: 'Old', image: 'https://x/y.jpg' }], NOW - 5 * 60 * 60 * 1000);
    let answer;
    const fetchReasons = vi.fn(() => new Promise((r) => (answer = r)));
    await render(base({ fetchReasons, logPicks: vi.fn() }));
    await flush();
    expect(latest.picks.map((p) => p.id)).toEqual(['old']);
    expect(latest.updating).toBe(true);
    await act(async () => answer({}));
    await flush();
    expect(latest.picks).toHaveLength(4);
    expect(latest.updating).toBe(false);
  });

  it('offline: keeps the last set on screen, flags it slow, and makes no call', async () => {
    const key = nearbyPicksCacheKey({ uid: 'u1', ratingsCount: 10, origin: ORIGIN, miles: 10, lastCategory: null });
    writeNearbyPicksCache(key, [{ id: 'last', region: 'villanova', name: 'Last', image: 'https://x/y.jpg' }], NOW - 5 * 60 * 60 * 1000);
    const fetchReasons = vi.fn(async () => ({}));
    await render(base({ fetchReasons, logPicks: vi.fn(), online: false }));
    await flush();
    expect(latest.picks.map((p) => p.id)).toEqual(['last']);
    expect(latest.updating).toBe(false);
    expect(latest.slow).toBe(true);
    expect(fetchReasons).not.toHaveBeenCalled();
  });

  it('a new set that comes back empty never replaces the cached one', async () => {
    // Bad connection: every candidate photo fails, so nothing can be composed.
    // Places with no photo of their own are always ready, so they are rated
    // "didn't like it" here to keep them out of the pool.
    const { rankNearbyCandidates, hasPhoto } = await import('../../lib/nearbyPicks');
    const { usual, fresh } = rankNearbyCandidates({ profile: PROFILE, origin: ORIGIN, miles: 10, myReviews: REVIEWS, now: NOW });
    const reviews = { ...REVIEWS };
    for (const p of [...usual, ...fresh]) {
      if (hasPhoto(p)) broken.add(p.image);
      else reviews[`x-${p.id}`] = { landmarkId: p.id, ratingTier: 'probably-skip' };
    }
    const key = nearbyPicksCacheKey({ uid: 'u1', ratingsCount: Object.keys(reviews).length, origin: ORIGIN, miles: 10, lastCategory: null });
    writeNearbyPicksCache(key, [{ id: 'last', region: 'villanova', name: 'Last', image: 'https://x/y.jpg' }], NOW - 5 * 60 * 60 * 1000);
    await render(base({ myReviews: reviews, fetchReasons: vi.fn(async () => ({})), logPicks: vi.fn() }));
    await flush();
    expect(latest.picks.map((p) => p.id)).toEqual(['last']);
  });

  it('rebuilds a set built this session once it is over 30 minutes old', async () => {
    const fetchReasons = vi.fn(async () => ({}));
    const props = base({ fetchReasons, logPicks: vi.fn() });
    await render(props);
    await flush();
    expect(fetchReasons).toHaveBeenCalledTimes(1);

    await act(async () => root.render(<Probe {...props} now={NOW + 10 * 60 * 1000} />));
    await flush();
    expect(fetchReasons).toHaveBeenCalledTimes(1); // still fresh

    await act(async () => root.render(<Probe {...props} now={NOW + 31 * 60 * 1000} />));
    await flush();
    expect(fetchReasons).toHaveBeenCalledTimes(2);
  });
});
