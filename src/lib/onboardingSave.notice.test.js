import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirrors firestore.rules for notifications/{id}: creating needs uid == you;
// writing over an existing doc is an update, which may only flip `read`.
const store = new Map();
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  setDoc: vi.fn(async (ref, data) => {
    if (ref.path.startsWith('notifications/') && store.has(ref.path)) {
      const err = new Error('denied');
      err.code = 'permission-denied';
      throw err;
    }
    store.set(ref.path, { ...(store.get(ref.path) || {}), ...data });
  }),
  updateDoc: vi.fn(async (ref, patch) => {
    store.set(ref.path, { ...store.get(ref.path), ...patch });
  }),
  deleteDoc: vi.fn(async () => {}),
  deleteField: vi.fn(),
  serverTimestamp: () => 0,
}));
vi.mock('./firebase', () => ({ db: {} }));

import { sendOnboardingNotice } from './onboardingSave';
import { onboardingNoticeId } from './onboardingVersion';

beforeEach(() => store.clear());

describe('sendOnboardingNotice', () => {
  it('never writes the same notifications doc for two different users', async () => {
    await sendOnboardingNotice('u1');
    await sendOnboardingNotice('u2');
    expect(store.get(`notifications/${onboardingNoticeId('u1')}`).uid).toBe('u1');
    expect(store.get(`notifications/${onboardingNoticeId('u2')}`).uid).toBe('u2');
  });

  it('retries cleanly when its own notification already exists', async () => {
    await sendOnboardingNotice('u1');
    store.get(`notifications/${onboardingNoticeId('u1')}`).read = true;
    await sendOnboardingNotice('u1');
    expect(store.get(`notifications/${onboardingNoticeId('u1')}`).read).toBe(false);
    expect(store.get('users/u1').onboardingNoticeVersion).toBeDefined();
  });
});
