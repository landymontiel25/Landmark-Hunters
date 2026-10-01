import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  addDoc: vi.fn(async () => ({ id: 't1' })),
  updateDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(),
  getDocs: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  serverTimestamp: vi.fn(),
  arrayUnion: vi.fn(),
  arrayRemove: vi.fn(),
}));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./notifications', () => ({ notifyUser: vi.fn(async () => {}) }));

import { createGroupTrip, addGroupMember, MAX_GROUP_MEMBERS } from './groupTrips';

describe('group trip member cap', () => {
  it('refuses 25 invited friends (26 people) with a readable message', async () => {
    const initialMembers = Array.from({ length: MAX_GROUP_MEMBERS }, (_, i) => ({ uid: `u${i}`, name: `n${i}` }));
    await expect(createGroupTrip({ ownerUid: 'o', ownerName: 'O', name: 'T', regionId: 'r', initialMembers })).rejects.toMatchObject({
      userMessage: expect.stringContaining('25'),
    });
  });
  it('allows 24 invited friends', async () => {
    const initialMembers = Array.from({ length: MAX_GROUP_MEMBERS - 1 }, (_, i) => ({ uid: `u${i}`, name: `n${i}` }));
    await expect(createGroupTrip({ ownerUid: 'o', ownerName: 'O', name: 'T', regionId: 'r', initialMembers })).resolves.toBe('t1');
  });
  it('refuses adding to a full trip', async () => {
    const memberUids = Array.from({ length: MAX_GROUP_MEMBERS }, (_, i) => `u${i}`);
    await expect(addGroupMember({ id: 't', memberUids }, 'x', 'X')).rejects.toMatchObject({ userMessage: expect.any(String) });
  });
});
