// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import OfflineSyncCelebration from './OfflineSyncCelebration';
import { OFFLINE_CHECKIN_SYNCED_EVENT } from '../lib/offlineCheckins';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const fire = (detail) => act(async () => window.dispatchEvent(new CustomEvent(OFFLINE_CHECKIN_SYNCED_EVENT, { detail })));

describe('offline check-in synced and paid (owner, 2026-11-25)', () => {
  it('plays the same full-screen check-in celebration, with the points, only when it paid', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => createRoot(el).render(<OfflineSyncCelebration />));
    await fire({ landmarkId: 'lh', landmarkName: 'Elbow Reef Lighthouse', saved: true, verified: false, awarded: 0 });
    await fire({ landmarkId: 'lh', landmarkName: 'Elbow Reef Lighthouse', saved: true, verified: true, awarded: 0 });
    expect(el.querySelector('.checkin-blast')).toBeNull();
    await fire({ landmarkId: 'lh', landmarkName: 'Elbow Reef Lighthouse', saved: true, verified: true, awarded: 100 });
    const blast = el.querySelector('.checkin-blast');
    expect(blast).toBeTruthy();
    expect(blast.querySelector('.blast-title').textContent).toBe('YOU CHECKED IN!');
    expect(blast.querySelector('.blast-name').textContent).toBe('Elbow Reef Lighthouse');
    expect(blast.querySelector('.blast-points').textContent).toBe('+100 pts');
    // Tap to close, like the online one.
    await act(async () => blast.click());
    expect(el.querySelector('.checkin-blast')).toBeNull();
  });
});
