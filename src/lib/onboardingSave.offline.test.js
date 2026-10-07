// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

// Offline, a Firestore write promise never settles (it waits in the local
// queue). The swipe save must still let the notes step move on.
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  setDoc: () => new Promise(() => {}),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  deleteField: () => 'DEL',
  serverTimestamp: () => 'SERVER_TS',
}));
vi.mock('./firebase', () => ({ db: {} }));

const { saveOnboardingResults } = await import('./onboardingSave');

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('saveOnboardingResults offline', () => {
  it('resolves as queued instead of hanging forever', async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    let settled = false;
    saveOnboardingResults('u1', {}, [], { complete: false, places: [] }).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(true);
  });
});
