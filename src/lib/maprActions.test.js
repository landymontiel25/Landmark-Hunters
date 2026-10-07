import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./placeLookup', async (orig) => ({
  ...(await orig()),
  lookupPlace: vi.fn(async () => ({ lat: 25.8003, lng: -80.1994, address: '2520 NW 2nd Ave, Miami' })),
}));
vi.mock('./groupTrips', () => ({
  addGroupMember: vi.fn(async () => {}),
  addGroupPlace: vi.fn(async () => {}),
  createGroupTrip: vi.fn(async () => 'g-new'),
  deleteGroupTrip: vi.fn(async () => {}),
  removeGroupPlace: vi.fn(async () => {}),
  renameGroupTrip: vi.fn(async () => {}),
  setGroupLandmarks: vi.fn(async () => {}),
}));
vi.mock('./friends', () => ({
  findUserByUsername: vi.fn(async (u) => (u === 'orlando' ? { uid: 'u-orlando', username: 'orlando' } : null)),
}));

import { runMaprActions, retryMaprAction } from './maprActions';
import { setGroupLandmarks, createGroupTrip, addGroupMember } from './groupTrips';
import { ALL_LANDMARKS } from '../data/regions';

// A tiny in-memory stand-in for TripContext.
function fakeTrip() {
  const trip = { byRegion: {}, placesByRegion: {}, itineraryNames: {} };
  const api = {
    regionsWithItineraries: () =>
      [...new Set([...Object.keys(trip.byRegion), ...Object.keys(trip.placesByRegion), ...Object.keys(trip.itineraryNames)])].filter(
        (r) => trip.byRegion[r]?.length || trip.placesByRegion[r]?.length || trip.itineraryNames[r]
      ),
    itineraryName: (r) => trip.itineraryNames[r] || r,
    getRegionSelection: (r) => trip.byRegion[r] || [],
    addLandmark: (id, r) => (trip.byRegion[r] = [...new Set([...(trip.byRegion[r] || []), id])]),
    removeLandmark: (id, r) => (trip.byRegion[r] = (trip.byRegion[r] || []).filter((x) => x !== id)),
    addPlace: (r, p) => (trip.placesByRegion[r] = [...(trip.placesByRegion[r] || []), p]),
    removePlace: (r, id) => (trip.placesByRegion[r] = (trip.placesByRegion[r] || []).filter((p) => p.id !== id)),
    renameItinerary: (r, n) => (n ? (trip.itineraryNames[r] = n) : delete trip.itineraryNames[r]),
    removeItinerary: (r) => {
      delete trip.byRegion[r];
      delete trip.placesByRegion[r];
      delete trip.itineraryNames[r];
    },
  };
  return { trip, api };
}

const miamiLandmark = ALL_LANDMARKS.find((l) => l.regionId === 'miami');
let t;
const ctx = (extra = {}) => ({ trip: t.trip, tripApi: t.api, groupTrips: [], user: { uid: 'me' }, ownerName: 'me', coords: null, conversationStops: [], ...extra });

beforeEach(() => {
  t = fakeTrip();
  vi.clearAllMocks();
});

describe('Mapr actions', () => {
  it('never starts a new itinerary without the traveler confirming', async () => {
    const action = { type: 'add_stop', stop: `miami/${miamiLandmark.id}`, itinerary: 'new' };
    const [r] = await runMaprActions([action], ctx());
    expect(r.ok).toBe(false);
    expect(r.needsConfirm).toBe(true);
    expect(r.text).toMatch(/Miami/);
    expect(t.api.regionsWithItineraries()).toEqual([]);

    const [created] = await runMaprActions([{ type: 'create_itinerary', name: 'Spring Break', city: 'miami' }], ctx());
    expect(created.needsConfirm).toBe(true);
    const [group] = await runMaprActions([{ type: 'create_itinerary', name: 'Crew', city: 'miami', group: true }], ctx());
    expect(group.needsConfirm).toBe(true);
    expect(createGroupTrip).not.toHaveBeenCalled();
    expect(t.api.regionsWithItineraries()).toEqual([]);
  });

  it('adds to an itinerary that already exists without asking', async () => {
    t.api.renameItinerary('miami', 'Miami');
    const [r] = await runMaprActions([{ type: 'add_stop', stop: `miami/${miamiLandmark.id}`, itinerary: 'miami' }], ctx());
    expect(r.ok).toBe(true);
    expect(t.trip.byRegion.miami).toEqual([miamiLandmark.id]);
  });

  it('adds a catalog stop to a new city itinerary once confirmed, and undo removes it', async () => {
    const [r] = await runMaprActions([{ type: 'add_stop', stop: `miami/${miamiLandmark.id}`, itinerary: 'new' }], ctx({ allowCreate: true }));
    expect(r.ok).toBe(true);
    expect(t.trip.byRegion.miami).toEqual([miamiLandmark.id]);
    await r.undo();
    expect(t.api.regionsWithItineraries()).not.toContain('miami');
  });

  it('adds a web place from the chat to the nearest city', async () => {
    const stops = [{ external: true, name: 'Autana Arepas', place: 'Miami', address: '2520 NW 2nd Ave', url: 'https://x.test' }];
    const [pending] = await runMaprActions([{ type: 'add_stop', stop: 'autana arepas', itinerary: 'new' }], ctx({ conversationStops: stops }));
    expect(pending.needsConfirm).toBe(true);
    expect(t.trip.placesByRegion.miami).toBeUndefined();
    const r = await retryMaprAction(pending.action, ctx({ conversationStops: stops }), { allowCreate: true });
    expect(r.ok).toBe(true);
    expect(t.trip.placesByRegion.miami?.[0]).toMatchObject({ name: 'Autana Arepas', url: 'https://x.test' });
  });

  it('does not pick a non-Latin-named chat place for some other name, or any place for an unreadable one', async () => {
    t.api.renameItinerary('miami', 'Miami');
    const stops = [
      { external: true, name: '東京タワー', place: 'Tokyo', address: '', url: 'https://x.test/a' },
      { external: true, name: 'Autana Arepas', place: 'Miami', address: '2520 NW 2nd Ave', url: 'https://x.test/b' },
    ];
    const [r] = await runMaprActions([{ type: 'add_stop', stop: 'Autana Arepas', itinerary: 'miami' }], ctx({ conversationStops: stops }));
    expect(r.ok).toBe(true);
    expect(t.trip.placesByRegion.miami?.[0]).toMatchObject({ name: 'Autana Arepas' });
    const [bad] = await runMaprActions([{ type: 'add_stop', stop: '🍕', itinerary: 'miami' }], ctx({ conversationStops: stops.slice(1) }));
    expect(bad.ok).toBe(false);
    expect(t.trip.placesByRegion.miami).toHaveLength(1);
  });

  it('refuses a stop it cannot identify', async () => {
    const [r] = await runMaprActions([{ type: 'add_stop', stop: 'Nowhere Diner', itinerary: 'new' }], ctx());
    expect(r.ok).toBe(false);
  });

  it('creates, renames and removes', async () => {
    await runMaprActions([{ type: 'create_itinerary', name: 'Spring Break', city: 'miami' }], ctx({ allowCreate: true }));
    expect(t.api.itineraryName('miami')).toBe('Spring Break');
    await runMaprActions([{ type: 'rename_itinerary', itinerary: 'Spring Break', name: 'Miami Weekend' }], ctx());
    expect(t.api.itineraryName('miami')).toBe('Miami Weekend');
    t.api.addLandmark(miamiLandmark.id, 'miami');
    const [r] = await runMaprActions([{ type: 'remove_stop', stop: miamiLandmark.name, itinerary: 'miami' }], ctx());
    expect(r.ok).toBe(true);
    expect(t.trip.byRegion.miami).toEqual([]);
  });

  it('does not remove a saved place for a name with no Latin letters or digits', async () => {
    t.api.addPlace('miami', { id: 'p1', name: 'Autana Arepas' });
    for (const stop of ['', '東京タワー']) {
      const [r] = await runMaprActions([{ type: 'remove_stop', stop, itinerary: 'miami' }], ctx());
      expect(r.ok).toBe(false);
      expect(r.text).toMatch(/Couldn't tell which place/);
    }
    expect(t.trip.placesByRegion.miami).toHaveLength(1);
  });

  it('adds a catalog stop to a group trip in the same city', async () => {
    const group = { id: 'g1', name: 'Crew Trip', regionId: 'miami', landmarkIds: [], memberUids: ['me'] };
    const [r] = await runMaprActions([{ type: 'add_stop', stop: miamiLandmark.name, itinerary: 'g1' }], ctx({ groupTrips: [group] }));
    expect(r.ok).toBe(true);
    expect(setGroupLandmarks).toHaveBeenCalledWith(group, [miamiLandmark.id], true);
  });

  it('adding someone to a solo itinerary turns it into a group trip', async () => {
    t.api.addLandmark(miamiLandmark.id, 'miami');
    const [r] = await runMaprActions([{ type: 'add_member', itinerary: 'miami', username: '@orlando' }], ctx());
    expect(r.ok).toBe(true);
    expect(createGroupTrip).toHaveBeenCalledWith(
      expect.objectContaining({ regionId: 'miami', landmarkIds: [miamiLandmark.id], initialMembers: [{ uid: 'u-orlando', name: 'orlando' }] })
    );
    expect(t.api.regionsWithItineraries()).not.toContain('miami');
  });

  it('adds someone to a group trip by username', async () => {
    const group = { id: 'g1', name: 'Crew Trip', regionId: 'miami', landmarkIds: [], memberUids: ['me'] };
    const [r] = await runMaprActions([{ type: 'add_member', itinerary: 'Crew Trip', username: 'orlando' }], ctx({ groupTrips: [group] }));
    expect(r.ok).toBe(true);
    expect(addGroupMember).toHaveBeenCalledWith(group, 'u-orlando', 'orlando');
  });

  it('reports an unknown username instead of failing silently', async () => {
    const group = { id: 'g1', name: 'Crew Trip', regionId: 'miami', landmarkIds: [], memberUids: ['me'] };
    const [r] = await runMaprActions([{ type: 'add_member', itinerary: 'g1', username: 'ghost' }], ctx({ groupTrips: [group] }));
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/ghost/);
  });

  it('ignores action types it does not know', async () => {
    const results = await runMaprActions([{ type: 'delete_account' }], ctx());
    expect(results).toEqual([]);
  });

  it('gives a specific message when the place lookup fails, and Retry succeeds once it works', async () => {
    const { lookupPlace } = await import('./placeLookup');
    lookupPlace.mockRejectedValueOnce(new Error('No match'));
    const stops = [{ external: true, name: 'Puyero Venezuelan Flavor', place: 'Villanova', address: '789 Lancaster Ave', url: 'https://x.test' }];
    const action = { type: 'add_stop', stop: 'Puyero Venezuelan Flavor', itinerary: 'new' };
    const [failed] = await runMaprActions([action], ctx({ conversationStops: stops }));
    expect(failed.ok).toBe(false);
    expect(failed.text).not.toMatch(/didn't go through/i);
    expect(failed.text).toMatch(/Puyero Venezuelan Flavor/);
    expect(failed.action).toEqual(action);

    // The place shouldn't have been added on the failed attempt: retrying
    // re-resolves the same action against a fresh lookup and succeeds once
    // the API cooperates.
    const retried = await retryMaprAction(failed.action, ctx({ conversationStops: stops }), { allowCreate: true });
    expect(retried.ok).toBe(true);
    expect(t.trip.placesByRegion.miami?.[0]).toMatchObject({ name: 'Puyero Venezuelan Flavor' });
  });
});
