// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import OfflineSyncCelebration, { syncCelebration } from './OfflineSyncCelebration';
import { OFFLINE_CHECKIN_SYNCED_EVENT } from '../lib/offlineCheckins';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const fire = (detail) => act(async () => window.dispatchEvent(new CustomEvent(OFFLINE_CHECKIN_SYNCED_EVENT, { detail })));
const mount = async () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(<OfflineSyncCelebration />));
  return { el, root };
};
const setVisibility = (v) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
const blast = (el) => el.querySelector('.checkin-blast');

beforeEach(() => {
  localStorage.clear();
  setVisibility('visible');
  document.body.innerHTML = '';
});

describe('offline check-in synced (owner, 2026-11-25)', () => {
  it('plays for the answer production actually sent: verified, already paid once (0 points)', async () => {
    const { el } = await mount();
    // offline_checkins result for the 6:38pm ET test at Hope Town Village Streets.
    await fire({ landmarkId: 'hope-town-village-streets', landmarkName: 'Hope Town Village Streets', saved: true, verified: true, awarded: 0 });
    expect(blast(el)).toBeTruthy();
    expect(blast(el).querySelector('.blast-title').textContent).toBe('YOU CHECKED IN!');
    expect(blast(el).querySelector('.blast-name').textContent).toBe('Hope Town Village Streets');
    // Same as online: no "+0 pts".
    expect(blast(el).querySelector('.blast-points')).toBeNull();
  });

  it('shows the points when it paid, and closes on a tap like the online one', async () => {
    const { el } = await mount();
    await fire({ landmarkId: 'lh', landmarkName: 'Elbow Reef Lighthouse', saved: true, verified: true, awarded: 100 });
    expect(blast(el).querySelector('.blast-points').textContent).toBe('+100 pts');
    await act(async () => blast(el).click());
    expect(blast(el)).toBeNull();
  });

  it('never plays for a check-in that was not verified, not saved, or a same-day repeat', async () => {
    const { el } = await mount();
    await fire({ landmarkId: 'a', saved: true, verified: false, awarded: 0 });
    await fire({ landmarkId: 'b', saved: false, verified: false, awarded: 0 });
    await fire({ landmarkId: 'c', saved: true, verified: true, sameDay: true, awarded: 0 });
    expect(blast(el)).toBeNull();
    expect(syncCelebration({ saved: true, verified: true, awarded: 100, landmarkId: 'x' }, 1)).toEqual({ key: 'x-1', name: '', points: 100 });
  });

  it('waits while the app is in the background and plays when it comes back', async () => {
    const { el } = await mount();
    setVisibility('hidden');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await fire({ landmarkId: 'lh', landmarkName: 'Elbow Reef Lighthouse', saved: true, verified: true, awarded: 100 });
    expect(blast(el)).toBeNull();
    setVisibility('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(blast(el).querySelector('.blast-name').textContent).toBe('Elbow Reef Lighthouse');
  });

  it('keeps one the app was closed on and plays it at the next launch', async () => {
    const first = await mount();
    setVisibility('hidden');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await fire({ landmarkId: 'tb', landmarkName: 'Tahiti Beach', saved: true, verified: true, awarded: 0 });
    await act(async () => first.root.unmount());
    setVisibility('visible');
    const { el } = await mount();
    expect(blast(el).querySelector('.blast-name').textContent).toBe('Tahiti Beach');
    await act(async () => blast(el).click());
    expect(localStorage.getItem('lh.offlineCelebrations')).toBeNull();
  });
});
