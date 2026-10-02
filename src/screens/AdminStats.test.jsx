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
});
