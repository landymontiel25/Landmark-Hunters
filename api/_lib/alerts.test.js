import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeDb, fakeFieldValue } from './fakeDb.testutil.js';

const pushes = vi.hoisted(() => []);
vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue }));
vi.mock('./push.js', () => ({ sendPushToUser: vi.fn(async (uid, msg) => { pushes.push({ uid, ...msg }); return { sent: 1 }; }) }));
const { followerAlert, followTipAlerts, levelUpsOf, nearbyFindAlerts, nightlyAlerts } = await import('./alerts.js');

const NOW = Date.parse('2026-10-13T12:00:00Z');
const DAY = 86400000;
const inbox = (db, uid) => Object.entries(db.docs).filter(([k, v]) => k.startsWith('notifications/') && v.uid === uid).map(([, v]) => v);

beforeEach(() => {
  pushes.length = 0;
});

describe('nightlyAlerts', () => {
  const went = (actor, tipId = 'fin_bell') => ({ finderUid: 'fin', actorUid: actor, tipId, landmarkId: 'liberty-bell', region: 'philly', kind: 'went' });
  it('tip went: one push a day per finder, counting people', async () => {
    const db = fakeDb({});
    await nightlyAlerts(db, { events: [went('a'), went('b')], nowMs: NOW });
    await nightlyAlerts(db, { events: [went('c')], nowMs: NOW + 1000 });
    expect(inbox(db, 'fin')).toHaveLength(1);
    expect(inbox(db, 'fin')[0].message).toMatch(/^2 people went to .+ because of your tip\.$/);
    expect(pushes).toHaveLength(1);
  });
  it('helpful is in-app only; a switched-off group sends nothing', async () => {
    const db = fakeDb({ 'users/fin/private/main': { notificationPrefs: { levelUp: false } } });
    await nightlyAlerts(db, { events: [{ ...went('a'), kind: 'helpful' }], levelUps: [{ uid: 'fin', region: 'philly', level: 'Local' }], nowMs: NOW });
    expect(inbox(db, 'fin').map((n) => n.type)).toEqual(['discovery_tipHelpful']);
    expect(pushes).toHaveLength(0);
  });
  it('level up pushes once per level and city', async () => {
    const db = fakeDb({});
    await nightlyAlerts(db, { levelUps: [{ uid: 'fin', region: 'philly', level: 'Trusted' }], nowMs: NOW });
    await nightlyAlerts(db, { levelUps: [{ uid: 'fin', region: 'philly', level: 'Trusted' }, { uid: 'fin', region: 'philly', level: 'Local' }], nowMs: NOW + DAY });
    expect(inbox(db, 'fin')).toHaveLength(1);
    expect(inbox(db, 'fin')[0].message).toContain("You're now Trusted in Philadelphia");
    expect(pushes).toHaveLength(1);
  });
  it('levelUpsOf counts only rises', () => {
    const prev = new Map([['a', { philly: 'Local' }], ['b', { philly: 'Trusted' }]]);
    const next = new Map([['a', { philly: 'Trusted' }], ['b', { philly: 'Local' }], ['c', { villanova: 'Local' }]]);
    expect(levelUpsOf(prev, next)).toEqual([{ uid: 'a', region: 'philly', level: 'Trusted' }, { uid: 'c', region: 'villanova', level: 'Local' }]);
  });
});

describe('followerAlert', () => {
  it('in-app always, push only for the first 10 followers', async () => {
    const db = fakeDb({ 'users/a': { username: 'ana' } });
    const db2 = fakeDb({ 'users/b': { username: 'bo' } });
    await followerAlert(db, { followerUid: 'a', followeeUid: 'f', followerCount: 10, nowMs: NOW });
    await followerAlert(db2, { followerUid: 'b', followeeUid: 'f', followerCount: 11, nowMs: NOW });
    expect(inbox(db, 'f').map((n) => n.message)).toEqual(['@ana followed you.']);
    expect(inbox(db2, 'f').map((n) => n.message)).toEqual(['@bo followed you.']);
    expect(pushes).toHaveLength(1);
  });
  it('follow, unfollow and follow again alerts once', async () => {
    const db = fakeDb({ 'users/a': { username: 'ana' } });
    for (let i = 0; i < 5; i++) await followerAlert(db, { followerUid: 'a', followeeUid: 'f', followerCount: 1, nowMs: NOW + i });
    expect(inbox(db, 'f')).toHaveLength(1);
  });
});

describe('followTipAlerts', () => {
  it('tells followers who have been to that city, at most 2 a day', async () => {
    const db = fakeDb({
      'follows/a_fin': { followerUid: 'a', followeeUid: 'fin' },
      'follows/b_fin': { followerUid: 'b', followeeUid: 'fin' },
      'checkins/a_x': { userId: 'a', region: 'philly', landmarkId: 'x' },
    });
    const tip = (lm) => ({ authorUid: 'fin', authorName: 'Fin', landmarkId: lm, region: 'philly', status: 'live' });
    for (const lm of ['liberty-bell', 'b', 'c']) await followTipAlerts(db, { tip: tip(lm), nowMs: NOW });
    expect(inbox(db, 'a')).toHaveLength(2);
    expect(inbox(db, 'b')).toHaveLength(0);
    expect(await followTipAlerts(db, { tip: { ...tip('d'), status: 'held' }, nowMs: NOW })).toBe(0);
  });
});

describe('nearbyFindAlerts', () => {
  it('a Trusted find within a mile of your last location, of a kind you like, once a week', async () => {
    const db = fakeDb({
      'users/u': { tagScores: { philly: { 'history-culture': 50 } }, tagScoresAt: { philly: { 'history-culture': NOW } } },
      'users/u/private/main': { lastKnownLocation: { lat: 39.9496, lng: -75.1503, at: NOW - 1000 } },
    });
    const ds = {
      tips: [{ authorUid: 'fin', authorName: 'Fin', landmarkId: 'liberty-bell-center', region: 'philly', status: 'live', hidden: false }],
      reviews: [],
      checkins: [{ userId: 'u', region: 'philly', landmarkId: 'x', createdAt: NOW - 1000 }],
    };
    const reputation = new Map([['fin', { philly: 'Trusted' }]]);
    expect(await nearbyFindAlerts(db, ds, { nowMs: NOW, reputation })).toBe(1);
    expect(inbox(db, 'u')[0].message).toMatch(/^A Trusted find near you: /);
    expect(await nearbyFindAlerts(db, ds, { nowMs: NOW + 3600000, reputation })).toBe(0);
    expect(await nearbyFindAlerts(fakeDb({ ...db.docs, 'alert_log/u': {} }), ds, { nowMs: NOW, reputation: new Map([['fin', { philly: 'Local' }]]) })).toBe(0);
    // A block either way: no alert naming that finder.
    expect(await nearbyFindAlerts(fakeDb({ ...db.docs, 'alert_log/u': {}, 'blocks/u_fin': { blockerUid: 'u', blockedUid: 'fin' } }), ds, { nowMs: NOW, reputation })).toBe(0);
  });
});
