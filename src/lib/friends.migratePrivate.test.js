import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

function setup({ privateDoc = null } = {}) {
  const setDoc = vi.fn(async () => {});
  const updateDoc = vi.fn(async () => {});
  vi.doMock('firebase/firestore', () => ({
    doc: (_db, ...path) => ({ path: path.join('/') }),
    getDoc: async () => ({ exists: () => !!privateDoc, data: () => privateDoc }),
    setDoc,
    updateDoc,
    deleteField: () => 'DELETE',
    serverTimestamp: () => 'ts',
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    getDocs: vi.fn(),
    onSnapshot: vi.fn(),
  }));
  vi.doMock('./firebase', () => ({ db: {} }));
  vi.doMock('./reviews', () => ({ syncMyReviewVisibility: async () => {} }));
  vi.doMock('./offlineWrite', () => ({ settleWrite: (p) => p }));
  return { setDoc, updateDoc };
}

describe('migratePrivateProfile', () => {
  it('copies legacy private fields to the private doc, then strips them (and an email displayName) from the public one', async () => {
    const { setDoc, updateDoc } = setup();
    const { migratePrivateProfile } = await import('./friends.js');
    await migratePrivateProfile(
      'u1',
      { username: 'ann', displayName: 'ann@x.com', email: 'ann@x.com', homeAddress: '1 Main', homeCoords: { lat: 1, lng: 2 }, pushTokens: { t1: {} } },
      'ann@x.com'
    );
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'users/u1/private/main' },
      expect.objectContaining({ email: 'ann@x.com', homeAddress: '1 Main', homeCoords: { lat: 1, lng: 2 }, pushTokens: { t1: {} } }),
      { merge: true }
    );
    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'users/u1' },
      { email: 'DELETE', homeAddress: 'DELETE', homeCoords: 'DELETE', pushTokens: 'DELETE', displayName: 'ann' }
    );
    // The copy lands before the delete, so a failure in between loses nothing.
    expect(setDoc.mock.invocationCallOrder[0]).toBeLessThan(updateDoc.mock.invocationCallOrder[0]);
  });

  it('does not overwrite a newer private value with the stale public one', async () => {
    const { setDoc } = setup({ privateDoc: { homeAddress: 'New place' } });
    const { migratePrivateProfile } = await import('./friends.js');
    await migratePrivateProfile('u2', { username: 'bo', homeAddress: 'Old place' }, 'bo@x.com');
    expect(setDoc.mock.calls[0][1]).not.toHaveProperty('homeAddress');
  });

  it('does nothing for an already-clean profile', async () => {
    const { setDoc, updateDoc } = setup();
    const { migratePrivateProfile } = await import('./friends.js');
    await migratePrivateProfile('u3', { username: 'cy', displayName: 'cy' }, 'cy@x.com');
    expect(setDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});
