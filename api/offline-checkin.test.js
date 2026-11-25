// Offline check-ins count from where the traveler was WHEN they checked in,
// never from where they are when the phone gets signal back (owner,
// 2026-11-24, Hope Town Inn in airplane mode).
import { describe, it, expect, vi } from 'vitest';

const place = { id: 'hope-town-inn-marina', regionId: 'abacos', name: 'Hope Town Inn & Marina', lat: 26.5381796, lng: -76.9625748, checkInRadiusMeters: 200, categories: ['food'] };
vi.mock('./_lib/loadPlace.js', () => ({ loadPlace: async () => place }));
const { syncOfflineCheckin } = await import('./offline-checkin.js');

// A small in-memory Firestore: docs by path, equality where(), transactions.
function fakeDb() {
  const docs = new Map();
  const snap = (path) => ({ id: path.split('/').pop(), exists: docs.has(path), data: () => docs.get(path), ref: ref(path) });
  const ref = (path) => ({
    path,
    get: async () => snap(path),
    set: async (data, opt) => docs.set(path, opt?.merge ? { ...(docs.get(path) || {}), ...data } : data),
    collection: (name) => col(`${path}/${name}`),
  });
  const col = (base) => {
    const filters = [];
    const q = {
      doc: (id) => ref(`${base}/${id}`),
      where: (f, _op, v) => (filters.push([f, v]), q),
      select: () => q,
      limit: () => q,
      get: async () => ({
        docs: [...docs.keys()].filter((k) => k.startsWith(`${base}/`) && k.split('/').length === base.split('/').length + 1).map(snap).filter((s) => filters.every(([f, v]) => s.data()[f] === v)),
      }),
    };
    return q;
  };
  return {
    docs,
    collection: (name) => col(name),
    runTransaction: async (fn) => fn({ get: (r) => r.get(), create: (r, d) => docs.set(r.path, d), set: (r, d) => docs.set(r.path, d), update: (r, d) => docs.set(r.path, { ...docs.get(r.path), ...d }) }),
  };
}

const capturedAtMs = Date.UTC(2026, 10, 24, 1, 5); // 8:05 pm ET, at the inn
const at = (metersNorth) => ({ lat: place.lat + metersNorth / 111320, lng: place.lng, accuracy: 10, timestamp: capturedAtMs });
// Where the phone is when the sync request goes out: 100 miles away.
const hundredMilesAway = { lat: place.lat + 160934 / 111320, lng: place.lng };

describe('offline check-in: judged by the fix taken when they checked in', () => {
  it('checked in 10 m from the inn, synced 3 hours later from 100 miles away: verified and paid', async () => {
    const db = fakeDb();
    const pay = vi.fn(async () => ({ awarded: 100 }));
    const notify = vi.fn(async () => {});
    const out = await syncOfflineCheckin(
      db,
      'u1',
      { clientId: 'job12345', region: 'abacos', landmarkId: place.id, fix: at(10), capturedAtMs, location: hundredMilesAway },
      { nowMs: capturedAtMs + 3 * 3600_000, pro: async () => false, pay, notify }
    );
    expect(out.body).toMatchObject({ saved: true, verified: true, via: 'gps', awarded: 100 });
    expect(pay).toHaveBeenCalledOnce();
    // Points landed: the notification goes out (owner, 2026-11-25).
    expect(notify).toHaveBeenCalledWith(db, 'u1', expect.objectContaining({ name: place.name, awarded: 100, landmarkId: place.id }));
    // The check-in is dated when they checked in, and its proof is the fix from then.
    const checkin = db.docs.get(`checkins/u1_${place.id}`);
    expect(checkin.createdAt.toMillis()).toBe(capturedAtMs);
    expect(db.docs.get(`checkins/u1_${place.id}/proof/main`)).toMatchObject({ lat: at(10).lat, lng: at(10).lng, verified: true });
  });

  it('checked in 5 km away, synced from right next to the inn: saved, never paid', async () => {
    const db = fakeDb();
    const pay = vi.fn(async () => ({ awarded: 100 }));
    const out = await syncOfflineCheckin(
      db,
      'u2',
      { clientId: 'job67890', region: 'abacos', landmarkId: place.id, fix: at(5000), capturedAtMs, location: { lat: place.lat, lng: place.lng } },
      { nowMs: capturedAtMs + 3600_000, pro: async () => false, pay, radiusOn: true, notify: vi.fn() }
    );
    expect(out.body).toMatchObject({ saved: true, verified: false, reason: 'too-far', awarded: 0 });
    expect(pay).not.toHaveBeenCalled();
  });

  it('a retried sync never makes a second check-in', async () => {
    const db = fakeDb();
    const pay = vi.fn(async () => ({ awarded: 100 }));
    const body = { clientId: 'jobretry1', region: 'abacos', landmarkId: place.id, fix: at(10), capturedAtMs };
    const first = await syncOfflineCheckin(db, 'u3', body, { nowMs: capturedAtMs + 60_000, pro: async () => false, pay });
    const again = await syncOfflineCheckin(db, 'u3', body, { nowMs: capturedAtMs + 120_000, pro: async () => false, pay });
    expect(again.body).toMatchObject({ checkinId: first.body.checkinId, already: true });
    expect([...db.docs.keys()].filter((k) => /^checkins\/u3_[^/]+$/.test(k))).toHaveLength(1);
    expect(pay).toHaveBeenCalledOnce();
  });

  it('the notification is sent once when the points land, never for a retry or an unpaid sync', async () => {
    const db = fakeDb();
    const notify = vi.fn(async () => {});
    const body = { clientId: 'jobnotify1', region: 'abacos', landmarkId: place.id, fix: at(10), capturedAtMs };
    const opts = { nowMs: capturedAtMs + 60_000, pro: async () => false, pay: async () => ({ awarded: 100 }), notify };
    await syncOfflineCheckin(db, 'u4', body, opts);
    await syncOfflineCheckin(db, 'u4', body, opts);
    expect(notify).toHaveBeenCalledOnce();
    await syncOfflineCheckin(fakeDb(), 'u5', { ...body, clientId: 'jobnotify2' }, { ...opts, pay: async () => ({ awarded: 0 }) });
    expect(notify).toHaveBeenCalledOnce();
  });

  it('the notification is an inbox row plus a push, with the same words', async () => {
    const { notifyOfflinePaid } = await import('./offline-checkin.js');
    const db = fakeDb();
    db.collection = ((orig) => (name) => (name === 'notifications' ? { add: async (d) => db.docs.set(`notifications/n1`, d) } : orig(name)))(db.collection);
    const push = vi.fn(async () => ({ sent: 1 }));
    await notifyOfflinePaid(db, 'u6', { name: 'Hope Town Inn & Marina', awarded: 100, landmarkId: place.id, region: 'abacos' }, { push });
    const row = db.docs.get('notifications/n1');
    expect(row).toMatchObject({ uid: 'u6', type: 'offline_checkin_paid', read: false, message: "Your offline check-in at Hope Town Inn & Marina synced and it's verified. +100 points." });
    expect(push).toHaveBeenCalledWith('u6', expect.objectContaining({ title: 'Check-in synced', body: row.message }));
  });
});

