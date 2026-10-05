// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import MaprPhase1Panel from './MaprPhase1Panel';
import { computeDailyReport } from '../lib/maprRank/metrics.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function render(el) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(el));
}

const T = Date.parse('2026-09-20T12:00:00Z');
const report = (date, shownAt) =>
  computeDailyReport(
    {
      openDays: [],
      recommendationLog: [{ userId: 'a', landmarkId: 'l1', region: 'milan', setId: 's', shownAt, distanceKm: 0.5, collabBoost: 0.1, rankLatencyMs: 3, variants: { ncf: 'treatment' } }],
      pickFeedback: [],
      reviews: [],
      checkins: [],
    },
    { date, now: shownAt + 86400000 }
  );

describe('MaprPhase1Panel', () => {
  it('asks for a first run when there are no reports', () => {
    render(<MaprPhase1Panel data={{ reports: [], status: null }} onRun={() => {}} run={{}} />);
    expect(host.textContent).toContain('No daily reports yet');
    expect(host.querySelector('button').disabled).toBe(true); // Download CSV
  });

  it('shows the latest report, the A/B tests and alerts, and runs the job', () => {
    const onRun = vi.fn();
    render(<MaprPhase1Panel data={{ reports: [report('2026-09-19', T - 86400000), report('2026-09-20', T)], status: { ncf: { action: 'promoted', evaluation: { testAccuracy: 0.8 } }, similarity: { regions: 3, ms: 120 } } }} onRun={onRun} run={{ running: false, text: '' }} />);
    expect(host.textContent).toContain('2026-09-20');
    expect(host.textContent).toContain('Match rate');
    expect(host.textContent).toContain('NCF');
    expect(host.textContent).toContain('holdout accuracy 80%');
    expect(host.querySelector('svg[role="img"]')).not.toBeNull();
    const run = [...host.querySelectorAll('button')].find((b) => b.textContent.startsWith('Run now'));
    act(() => run.click());
    expect(onRun).toHaveBeenCalledOnce();
  });
});
