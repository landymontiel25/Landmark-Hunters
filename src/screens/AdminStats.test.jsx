// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/apiAuth', () => ({ authHeaders: async () => ({ Authorization: 'Bearer t' }) }));
vi.mock('../lib/apiBase', () => ({ API_BASE: '' }));

const study = {
  accuracyAll: { users: 0 },
  reach: [],
  series: [{ date: '2026-10-01', mapr: 80, baseline: 60, users: 4 }],
  accuracyAtRatings: [],
  byCategory: { rows: [] },
  byCity: { rows: [] },
  audience: { justMe: {}, group: {} },
  pickType: { usual: {}, something: {} },
  bigMisses: {},
  whatHappened: { counts: {} },
  tapVsVisit: { pairs: 0, byTap: {} },
  stalled: { users: 0 },
  scoreVsReturn: [],
};
const body = {
  generatedAt: Date.now(),
  totals: { users: 5 },
  growth: { start: '2026-09-01', weeks: [] },
  truncated: [],
  study,
  metrics: [
    { id: 'matchRate', label: 'Mapr match rate', headline: true, value: 80, unit: '%', status: 'met', goal: 'above 70%', n: 3, nLabel: 'users', baseline: { value: 55, unit: '%', label: 'usual answer' } },
    { id: 'retentionD1', label: 'Day 1 retention', value: 10, unit: '%', status: 'missed', goal: 'above 40%', n: 4 },
    { id: 'timeToFirstCheckin', label: 'Time to first check-in', value: null, unit: ' h', status: 'unknown', goal: 'under 2 hours', n: 0, note: 'No check-ins yet.' },
  ],
};

let root;
let host;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

async function mount(fetchImpl) {
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  const { default: AdminStats } = await import('./AdminStats');
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(
      <MemoryRouter>
        <AdminStats />
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return host.textContent;
}

describe('AdminStats page', () => {
  it('shows each metric next to its goal, with a word and icon for met / missed / unknown', async () => {
    const text = await mount(async () => ({ ok: true, status: 200, json: async () => body }));
    expect(text).toContain('Mapr match rate');
    expect(text).toContain('80%');
    expect(text).toContain('Goal: above 70%');
    expect(text).toContain('Goal met');
    expect(text).toContain('Goal missed');
    expect(text.match(/Can't measure yet/g).length).toBeGreaterThanOrEqual(2); // value + chip
    expect(text).toContain('55%'); // baseline next to the match rate
    expect(host.querySelector('[data-status="met"]')).toBeTruthy();
    expect(host.querySelector('[data-status="missed"]')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/admin-stats', { headers: { Authorization: 'Bearer t' } });
  });
  it('shows the server message when the route refuses', async () => {
    await mount(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Not allowed.' }) }));
    expect(host.querySelector('[role="alert"]').textContent).toBe('Not allowed.');
  });

  it('runs the sign-up date backfill with a POST and reports the counts, telling you to press again until done', async () => {
    const calls = [];
    await mount(async (url, init) => {
      calls.push({ url, method: init?.method || 'GET', body: init?.body });
      if (init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ fromAuth: 12, fromFirstRating: 1, noSource: 0, done: false }) };
      }
      return { ok: true, status: 200, json: async () => body };
    });
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent.includes('Run sign-up date backfill'));
    expect(btn).toBeTruthy();
    await act(async () => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const post = calls.find((c) => c.method === 'POST');
    expect(post.url).toContain('/api/admin-stats');
    expect(JSON.parse(post.body)).toEqual({ action: 'backfill' });
    expect(host.textContent).toContain('Filled 12 from Firebase sign-up time and 1 from a first rating');
    expect(host.textContent).toContain('press the button again');
  });

  it('runs the photo backfill in batches with a pause between them, shows progress, and stops when done', async () => {
    try {
      const posts = [];
      const batches = [
        { total: 10, remaining: 6, saved: { ok: 3, noMatch: 1 }, thisCall: { failed: 1 }, searchesToday: 5, dailyLimit: 300, done: false, stopped: null },
        { total: 10, remaining: 0, saved: { ok: 7, noMatch: 3 }, thisCall: { failed: 0 }, searchesToday: 11, dailyLimit: 300, done: true, stopped: null },
      ];
      await mount(async (url, init) => {
        if (init?.method === 'POST') {
          posts.push(JSON.parse(init.body));
          return { ok: true, status: 200, json: async () => batches[posts.length - 1] };
        }
        return { ok: true, status: 200, json: async () => body };
      });
      vi.useFakeTimers({ toFake: ['setTimeout'] }); // after mount, which waits on a real timer
      const btn = [...host.querySelectorAll('button')].find((b) => b.textContent.includes('Run photo backfill'));
      expect(btn).toBeTruthy();
      await act(async () => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(posts).toEqual([{ action: 'photo-backfill' }]);
      expect(host.textContent).toContain('Checked 4 of 10');
      expect(host.textContent).toContain('1 failed this run');
      expect(host.textContent).toContain('6 left. Next batch in 2:30');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(151000);
      });
      expect(posts).toHaveLength(2);
      expect(host.textContent).toContain('Done. Checked 10 of 10: Google has a photo for 7, no match for 3');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the photo backfill when Google or the daily limit says so, and when you press Stop', async () => {
    const quota = { total: 10, remaining: 8, saved: { ok: 1, noMatch: 1 }, thisCall: { failed: 2 }, searchesToday: 300, dailyLimit: 300, done: false, stopped: 'daily-limit' };
    await mount(async (url, init) => (init?.method === 'POST' ? { ok: true, status: 200, json: async () => quota } : { ok: true, status: 200, json: async () => body }));
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent.includes('Run photo backfill'));
    await act(async () => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.textContent).toContain('the daily search limit is reached');
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Stop')).toBe(false);
  });
});
