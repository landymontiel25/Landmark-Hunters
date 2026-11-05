// @vitest-environment jsdom
// Owner, 2026-11-05: the Landmarks list shows 25 a page, each page's ratings
// load up front, and the next page's load behind them.
import { describe, it, expect, vi, beforeEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const calls = [];
const answers = {};
vi.mock('./landmarkRatings', () => ({
  loadLandmarkRatings: vi.fn(async (l) => {
    calls.push(l.id);
    return answers[l.id] || { google: null, tripadvisor: null, googleNoRating: false };
  }),
}));

import { usePageRatings, ratingKey } from './usePageRatings';

const lm = (id) => ({ id, name: id, regionId: 'philly' });
const g = (rating, count) => ({ google: { rating, count }, tripadvisor: null, googleNoRating: false });
let latest;

function Probe({ current, next, enabled = true }) {
  latest = usePageRatings(current, next, enabled);
  return null;
}
async function mount(props) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<Probe {...props} />);
  });
  const rerender = async (p) => {
    await act(async () => {
      root.render(<Probe {...p} />);
    });
  };
  return { rerender };
}

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
  latest = undefined;
});

describe('usePageRatings', () => {
  it('loads the current page first, then the next page', async () => {
    for (const id of ['a', 'b', 'c', 'd']) answers[id] = g(4.5, 100);
    await mount({ current: [lm('a'), lm('b')], next: [lm('c'), lm('d')] });
    expect(calls).toEqual(['a', 'b', 'c', 'd']);
    expect(Object.keys(latest).sort()).toEqual(['philly/a', 'philly/b', 'philly/c', 'philly/d']);
    expect(latest[ratingKey(lm('a'))].google.rating).toBe(4.5);
  });

  it('asks for nothing when it is off (signed out, or the flag is off)', async () => {
    await mount({ current: [lm('a')], next: [lm('b')], enabled: false });
    expect(calls).toEqual([]);
    expect(latest).toEqual({});
  });

  it('keeps no answer for a failed or empty lookup, so the row can try itself', async () => {
    answers.a = g(4.0, 10);
    await mount({ current: [lm('a'), lm('b')], next: [] });
    expect(Object.keys(latest)).toEqual(['philly/a']);
  });

  it('keeps an answer that says Google has no rating', async () => {
    answers.a = { google: null, tripadvisor: null, googleNoRating: true };
    await mount({ current: [lm('a')], next: [] });
    expect(latest['philly/a'].googleNoRating).toBe(true);
  });

  it('moving to the next page reuses its answers (no second call) and drops the page left behind', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) answers[id] = g(4.2, 50);
    const { rerender } = await mount({ current: [lm('a'), lm('b')], next: [lm('c'), lm('d')] });
    expect(calls).toEqual(['a', 'b', 'c', 'd']);
    await rerender({ current: [lm('c'), lm('d')], next: [lm('e'), lm('f')] });
    expect(calls).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(Object.keys(latest).sort()).toEqual(['philly/c', 'philly/d', 'philly/e', 'philly/f']);
  });

  it('skips items that are not places, like a divider', async () => {
    answers.a = g(4.8, 9);
    await mount({ current: [lm('a'), { id: 'divider' }, null], next: [] });
    expect(calls).toEqual(['a']);
  });
});
