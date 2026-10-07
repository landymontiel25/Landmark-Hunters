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
  serverTimestamp: vi.fn(() => 'ts'),
  arrayUnion: vi.fn((...a) => ({ union: a })),
  arrayRemove: vi.fn(),
}));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./notifications', () => ({ notifyUser: vi.fn(async () => {}) }));

import { addDoc, updateDoc } from 'firebase/firestore';
import { createGroupTrip, addGroupMember, MAX_GROUP_MEMBERS, withUnshownIds } from './groupTrips';

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

describe('withUnshownIds (group route reorder)', () => {
  it('keeps ids the route does not show, after the new order', () => {
    expect(withUnshownIds(['b', 'a'], ['a', 'custom1', 'b', 'other'])).toEqual(['b', 'a', 'custom1', 'other']);
  });
  it('still drops ids the user just removed', () => {
    expect(withUnshownIds(['b'], ['a', 'b', 'custom1'], (id) => id === 'a')).toEqual(['b', 'custom1']);
  });
  it('handles a trip with no landmarkIds', () => {
    expect(withUnshownIds(['a'], undefined)).toEqual(['a']);
  });
});

describe('no undefined in group trip writes (Firestore refuses the whole write)', () => {
  const hasUndefined = (v) => v === undefined || (v && typeof v === 'object' && Object.values(v).some(hasUndefined));
  it('create: a nameless member or a place with no address', async () => {
    addDoc.mockClear();
    await createGroupTrip({
      ownerUid: 'o',
      ownerName: undefined,
      name: 'T',
      regionId: 'r',
      places: [{ id: 'p1', name: 'P', address: undefined, lat: 1, lng: 2, url: undefined }],
      initialMembers: [{ uid: 'f', name: undefined }],
    });
    const data = addDoc.mock.calls[0][1];
    expect(hasUndefined(data)).toBe(false);
    expect(data.memberNames).toEqual({ o: null, f: null });
    expect(data.places).toEqual([{ id: 'p1', name: 'P', lat: 1, lng: 2 }]);
  });
  it('add member with no name', async () => {
    updateDoc.mockClear();
    await addGroupMember({ id: 't', memberUids: ['o'] }, 'x', undefined);
    expect(hasUndefined(updateDoc.mock.calls[0][1])).toBe(false);
  });
});
