// Emulator tests for firestore.rules / storage.rules (the access-tightening
// pass: private profile doc, bonus points, region_stats, streaks, referral,
// admin notifications, reply visibility, check-in reads).
//
// Not part of `npm test` (needs Java + the Firebase emulators). Run with:
//   npm i --no-save firebase-tools @firebase/rules-unit-testing
//   npx firebase emulators:exec --only firestore,storage --project demo-lh "node scripts/rules-test.mjs"
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where,
  writeBatch, increment, serverTimestamp, deleteField,
} from 'firebase/firestore';
import { ref, getBytes, listAll, uploadBytes } from 'firebase/storage';

const ADMIN_EMAIL = 'landymontiel25@gmail.com';
const env = await initializeTestEnvironment({
  projectId: 'demo-lh',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  storage: { rules: readFileSync('storage.rules', 'utf8') },
});

let failed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]);
  }
}
const as = (uid, claims = {}) => env.authenticatedContext(uid, { email: `${uid}@x.com`, email_verified: true, ...claims }).firestore();
const seed = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));

async function reset() {
  await env.clearFirestore();
}

console.log('users: public profile vs private doc');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'users/alice'), { uid: 'alice', username: 'alice', email: 'alice@x.com', homeAddress: '1 Main', homeCoords: { lat: 1, lng: 2 }, pushTokens: { tok: { platform: 'ios' } } });
  await setDoc(doc(db, 'users/bob'), { uid: 'bob', username: 'bob' });
});
await t('another user can read a public profile', () => assertSucceeds(getDoc(doc(as('bob'), 'users/alice'))));
await t('signed out cannot read users', () => assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/alice'))));
await t('owner reads + writes own private doc', async () => {
  const db = as('alice');
  await assertSucceeds(setDoc(doc(db, 'users/alice/private/main'), { email: 'alice@x.com', homeAddress: '1 Main', pushTokens: { t: { platform: 'ios' } }, updatedAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(getDoc(doc(db, 'users/alice/private/main')));
});
await t("others cannot read or write someone's private doc", async () => {
  await assertFails(getDoc(doc(as('bob'), 'users/alice/private/main')));
  await assertFails(setDoc(doc(as('bob'), 'users/alice/private/main'), { email: 'alice@x.com' }));
});
await t('private doc email must be the real sign-in email', () => assertFails(setDoc(doc(as('alice'), 'users/alice/private/main'), { email: 'other@x.com' })));
await t('private doc rejects unknown fields and other doc ids', async () => {
  await assertFails(setDoc(doc(as('alice'), 'users/alice/private/main'), { isAdmin: true }));
  await assertFails(setDoc(doc(as('alice'), 'users/alice/private/other'), { email: 'alice@x.com' }));
});
await t('migration: owner can delete the legacy private fields (incl. email) off the public doc', () =>
  assertSucceeds(updateDoc(doc(as('alice'), 'users/alice'), { email: deleteField(), homeAddress: deleteField(), homeCoords: deleteField(), pushTokens: deleteField(), displayName: 'alice' })));
await t('a public-doc email must still be the real one', () => assertFails(updateDoc(doc(as('bob'), 'users/bob'), { email: 'evil@x.com' })));
await t('account deletion: owner can delete private doc and public doc', async () => {
  const db = as('alice');
  await assertSucceeds(deleteDoc(doc(db, 'users/alice/private/main')));
  await assertSucceeds(deleteDoc(doc(db, 'users/alice')));
});

console.log('bonusPoints');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'users/carl'), { uid: 'carl', username: 'carl', bonusPoints: 0 });
  await setDoc(doc(db, 'users/dana'), { uid: 'dana', username: 'dana', bonusPoints: 0, onboardingCompleted: true });
});
await t('cannot bump bonusPoints by hand (+100, +1, +50)', async () => {
  for (const n of [100, 1, 50]) await assertFails(updateDoc(doc(as('carl'), 'users/carl'), { bonusPoints: n }));
});
await t('onboarding: +10 together with onboardingCompleted false->true', () =>
  assertSucceeds(setDoc(doc(as('carl'), 'users/carl'), { onboardingCompleted: true, bonusPoints: increment(10) }, { merge: true })));
await t('onboarding bonus cannot be re-earned (+10 again, or un-completing)', async () => {
  await assertFails(updateDoc(doc(as('carl'), 'users/carl'), { bonusPoints: increment(10) }));
  await assertFails(updateDoc(doc(as('carl'), 'users/carl'), { onboardingCompleted: false }));
  await assertFails(updateDoc(doc(as('dana'), 'users/dana'), { bonusPoints: increment(10) }));
});
await t('bonusPoints never goes down', () => assertFails(updateDoc(doc(as('carl'), 'users/carl'), { bonusPoints: 0 })));

console.log('referrals');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'users/ref'), { uid: 'ref', username: 'ref', bonusPoints: 0 });
  await setDoc(doc(db, 'users/new1'), { uid: 'new1', username: 'new1', bonusPoints: 0 });
  await setDoc(doc(db, 'users/new2'), { uid: 'new2', username: 'new2', bonusPoints: 0 });
});
const refDoc = (referrerUid, referredUid) => ({ referrerUid, referrerUsername: referrerUid, referredUid, referredClaimed: false, referrerClaimed: false, createdAt: serverTimestamp() });
await t('referral to a real referrer works; to a nonexistent uid, or with extra fields, does not', async () => {
  await assertSucceeds(setDoc(doc(as('new1'), 'referrals/new1'), refDoc('ref', 'new1')));
  await assertFails(setDoc(doc(as('new2'), 'referrals/new2'), refDoc('ghost', 'new2')));
  await assertFails(setDoc(doc(as('new2'), 'referrals/new2'), { ...refDoc('ref', 'new2'), bonus: 1 }));
});
await t('referrer cannot claim before the referred person has', async () => {
  const db = as('ref');
  const b = writeBatch(db);
  b.set(doc(db, 'users/ref'), { bonusPoints: increment(50), bonusSource: 'new1' }, { merge: true });
  b.update(doc(db, 'referrals/new1'), { referrerClaimed: true });
  await assertFails(b.commit());
});
await t('referred claim needs a verified email', async () => {
  const db = as('new1', { email_verified: false });
  const b = writeBatch(db);
  b.set(doc(db, 'users/new1'), { bonusPoints: increment(50) }, { merge: true });
  b.update(doc(db, 'referrals/new1'), { referredClaimed: true });
  await assertFails(b.commit());
});
await t('referred claim: +50 batched with the flag works, but not twice and not without the flag', async () => {
  const db = as('new1');
  await assertFails(updateDoc(doc(db, 'users/new1'), { bonusPoints: increment(50) }));
  const b = writeBatch(db);
  b.set(doc(db, 'users/new1'), { bonusPoints: increment(50) }, { merge: true });
  b.set(doc(db, 'leaderboard_entries/weekly_2026-W40_new1'), { userId: 'new1', userName: 'n', period: 'weekly', periodKey: '2026-W40', points: increment(50), updatedAt: serverTimestamp() }, { merge: true });
  b.update(doc(db, 'referrals/new1'), { referredClaimed: true });
  await assertSucceeds(b.commit());
  await assertFails(updateDoc(doc(db, 'users/new1'), { bonusPoints: increment(50) }));
  const b2 = writeBatch(db);
  b2.set(doc(db, 'users/new1'), { bonusPoints: increment(50) }, { merge: true });
  b2.update(doc(db, 'referrals/new1'), { referredClaimed: true });
  await assertFails(b2.commit());
});
await t('referrer claim: +50 batched with flag + bonusSource works once', async () => {
  const db = as('ref');
  const mk = () => {
    const b = writeBatch(db);
    b.set(doc(db, 'users/ref'), { bonusPoints: increment(50), bonusSource: 'new1' }, { merge: true });
    b.update(doc(db, 'referrals/new1'), { referrerClaimed: true });
    return b;
  };
  await assertSucceeds(mk().commit());
  await assertFails(mk().commit());
});
await t('a stranger cannot claim someone else\'s referral', async () => {
  const db = as('new2');
  const b = writeBatch(db);
  b.set(doc(db, 'users/new2'), { bonusPoints: increment(50), bonusSource: 'new1' }, { merge: true });
  b.update(doc(db, 'referrals/new1'), { referrerClaimed: true });
  await assertFails(b.commit());
});

console.log('checkins');
await reset();
const ck = (over = {}) => ({ userId: 'erin', userName: 'e', landmarkId: 'lm', landmarkName: 'L', region: 'r', points: 100, basePoints: 100, visitNumber: 1, ratingOnly: false, visited: true, insideHomeRadius: false, createdAt: serverTimestamp(), ...over });
await t('signed-out users cannot read check-ins; signed-in can', async () => {
  await seed((db) => setDoc(doc(db, 'checkins/erin_lm'), { userId: 'erin', points: 100 }));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'checkins/erin_lm')));
  await assertSucceeds(getDoc(doc(as('bob'), 'checkins/erin_lm')));
});
await t('check-in payout follows the visit taper', async () => {
  const db = as('erin');
  await assertSucceeds(setDoc(doc(db, 'checkins/erin_a'), ck({ landmarkId: 'a' })));
  await assertSucceeds(setDoc(doc(db, 'checkins/erin_a_2'), ck({ landmarkId: 'a', visitNumber: 2, points: 20 })));
  await assertFails(setDoc(doc(db, 'checkins/erin_a_3'), ck({ landmarkId: 'a', visitNumber: 3, points: 100 })));
  await assertFails(setDoc(doc(db, 'checkins/erin_a_7'), ck({ landmarkId: 'a', visitNumber: 7, points: 20 })));
  await assertSucceeds(setDoc(doc(db, 'checkins/erin_a_8'), ck({ landmarkId: 'a', visitNumber: 7, points: 0 })));
  await assertFails(setDoc(doc(db, 'checkins/erin_b'), ck({ landmarkId: 'b', ratingOnly: true, points: 50 })));
  await assertSucceeds(setDoc(doc(db, 'checkins/erin_c'), ck({ landmarkId: 'c', ratingOnly: true, visited: false, points: 0 })));
});

console.log('region_stats');
await reset();
await seed((db) => setDoc(doc(db, 'checkins/erin_lm1'), { userId: 'erin', points: 100 }));
const bump = (db, id, inc = 1, extra = {}) => setDoc(doc(db, 'region_stats/miami'), { counts: { [id]: increment(inc) }, lastBump: id, updatedAt: serverTimestamp(), ...extra }, { merge: true });
await t('bump: +1 for a landmark you checked in at (first write creates the doc)', () => assertSucceeds(bump(as('erin'), 'lm1')));
await t('bump again +1 works; +2 and a bump for a landmark with no check-in do not', async () => {
  await assertSucceeds(bump(as('erin'), 'lm1'));
  await assertFails(bump(as('erin'), 'lm1', 2));
  await assertFails(bump(as('erin'), 'lm2'));
  await assertFails(bump(as('bob'), 'lm1'));
});
await t('cannot overwrite counts directly or touch two landmarks', async () => {
  const db = as('erin');
  await assertFails(setDoc(doc(db, 'region_stats/miami'), { counts: { lm1: 9999 }, lastBump: 'lm1', updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(doc(db, 'region_stats/miami'), { counts: { lm1: increment(1), other: 500 }, lastBump: 'lm1', updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(deleteDoc(doc(db, 'region_stats/miami')));
});
await t('backfill works while the region is not backfilled, then locks (even over bump leftovers)', async () => {
  const db = as('bob');
  await assertSucceeds(setDoc(doc(db, 'region_stats/miami'), { counts: { lm1: 12, lm9: 3 }, backfilled: true, lastBump: deleteField(), updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(doc(db, 'region_stats/miami'), { counts: { lm1: 1 }, backfilled: true, lastBump: deleteField(), updatedAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(bump(as('erin'), 'lm1')); // a bump still works once backfilled
});
await t('signed out cannot write region_stats; anyone can still read', async () => {
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'region_stats/x'), { counts: {}, backfilled: true }));
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'region_stats/miami')));
});

console.log('streaks');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'friend_edges/fay_gus'), { owner: 'fay', friend: 'gus' });
  await setDoc(doc(db, 'friend_edges/gus_fay'), { owner: 'gus', friend: 'fay' });
});
const streak = (a, b) => ({ mode: 'dual', memberIds: [a, b].sort(), count: 0, best: 0, lastCompletedDay: null, freezesLeft: 2, frozenDays: [] });
await t('streak with a friend works, with a stranger does not, with yourself does not', async () => {
  const [a, b] = ['fay', 'gus'].sort();
  await assertSucceeds(setDoc(doc(as('fay'), `streaks/${a}_${b}`), streak('fay', 'gus')));
  await assertFails(setDoc(doc(as('gus'), 'streaks/gus_gus'), streak('gus', 'gus')));
  await assertFails(setDoc(doc(as('fay'), 'streaks/fay_zed'), streak('fay', 'zed')));
  await assertFails(setDoc(doc(as('zed'), `streaks/${a}_${b}x`), streak('zed', 'fay')));
  await assertFails(setDoc(doc(as('fay'), 'streaks/fay_fay'), { ...streak('fay', 'fay'), memberIds: ['fay', 'fay'] }));
});

console.log('notifications to the admin');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'users/adm'), { uid: 'adm', username: 'adm' });
  await setDoc(doc(db, 'users/adm/private/main'), { email: ADMIN_EMAIL });
  await setDoc(doc(db, 'users/hal'), { uid: 'hal', username: 'hal' });
  await setDoc(doc(db, 'feature_requests/fr1'), { userId: 'hal', userName: 'Hal', title: 'Dark mode', status: 'pending' });
  await setDoc(doc(db, 'feature_requests/fr2'), { userId: 'other', userName: 'Other', title: 'x', status: 'pending' });
});
const note = (over) => ({ uid: 'adm', type: 'feature_request', message: '\u{1F4A1} New feature request from Hal: "Dark mode"', landmarkId: null, groupTripId: null, featureRequestId: 'fr1', bugReportId: null, read: false, createdAt: serverTimestamp(), ...over });
await t('the real notice for your own request works', () => assertSucceeds(setDoc(doc(as('hal'), 'notifications/n1'), note())));
await t('forged text, someone else\'s request, a missing request, or a non-admin target are all denied', async () => {
  const db = as('hal');
  await assertFails(setDoc(doc(db, 'notifications/n2'), note({ message: 'Your account is locked, click here' })));
  await assertFails(setDoc(doc(db, 'notifications/n3'), note({ featureRequestId: 'fr2' })));
  await assertFails(setDoc(doc(db, 'notifications/n4'), note({ featureRequestId: 'nope' })));
  await assertFails(setDoc(doc(db, 'notifications/n5'), note({ uid: 'hal2' })));
  await assertFails(setDoc(doc(db, 'notifications/n6'), note({ type: 'whatever' })));
});
await t('admin pointer: only the admin can set it, to their own uid; then it identifies the admin', async () => {
  await assertFails(setDoc(doc(as('hal'), 'admin_pointer/current'), { uid: 'hal', updatedAt: serverTimestamp() }));
  const adminDb = env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: true }).firestore();
  await assertFails(setDoc(doc(adminDb, 'admin_pointer/current'), { uid: 'hal', updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(adminDb, 'admin_pointer/current'), { uid: 'adm', updatedAt: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(as('hal'), 'admin_pointer/current')));
  await assertSucceeds(setDoc(doc(as('hal'), 'notifications/n7'), note()));
});

console.log('reply reads');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'users/ivy'), { uid: 'ivy', username: 'ivy', public: true });
  await setDoc(doc(db, 'reviews/ivy_lm'), { userId: 'ivy', landmarkId: 'lm', stars: 5, comment: 'c', hidden: false, reportedBy: [], visibility: 'public' });
  await setDoc(doc(db, 'reviews/ivy_hid'), { userId: 'ivy', landmarkId: 'hid', stars: 5, comment: 'c', hidden: true, reportedBy: ['a', 'b'], visibility: 'public' });
  await setDoc(doc(db, 'reviews/ivy_lm/replies/r1'), { uid: 'x', userName: 'x', text: 'hi' });
  await setDoc(doc(db, 'reviews/ivy_hid/replies/r1'), { uid: 'x', userName: 'x', text: 'hi' });
  await setDoc(doc(db, 'blocks/ivy_jon'), { blockerUid: 'ivy', blockedUid: 'jon' });
  await setDoc(doc(db, 'blocks/kim_ivy'), { blockerUid: 'kim', blockedUid: 'ivy' });
});
await t('replies on a visible review can be read (list and get)', async () => {
  await assertSucceeds(getDocs(collection(as('lou'), 'reviews/ivy_lm/replies')));
  await assertSucceeds(getDoc(doc(as('lou'), 'reviews/ivy_lm/replies/r1')));
});
await t('replies on a hidden (2+ reports) review are hidden from others, not from the author or admin', async () => {
  await assertFails(getDocs(collection(as('lou'), 'reviews/ivy_hid/replies')));
  await assertSucceeds(getDocs(collection(as('ivy'), 'reviews/ivy_hid/replies')));
  await assertSucceeds(getDocs(collection(env.authenticatedContext('adm', { email: ADMIN_EMAIL }).firestore(), 'reviews/ivy_hid/replies')));
});
await t('replies are hidden across a block, either direction', async () => {
  await assertFails(getDocs(collection(as('jon'), 'reviews/ivy_lm/replies')));
  await assertFails(getDocs(collection(as('kim'), 'reviews/ivy_lm/replies')));
});

console.log('recommendation_log: shown-pick fields');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'recommendation_log/own'), { userId: 'ann', landmarkId: 'a', setId: 's', rank: 1 });
});
const rec = (o = {}) => ({ userId: 'ann', landmarkId: 'a', pickType: null, ...o });
const shown = { setId: 'ann-1-x', rank: 2, shownAt: Date.now(), surface: 'map-sheet', predicted: 'positive' };
await t('recommendation_log: old-style row (no new fields) still creates', () => assertSucceeds(setDoc(doc(as('ann'), 'recommendation_log/r1'), rec())));
await t('recommendation_log: shown row with all new fields creates', () => assertSucceeds(setDoc(doc(as('ann'), 'recommendation_log/r2'), rec(shown))));
await t('recommendation_log: predicted may be null, neutral or negative', async () => {
  await assertSucceeds(setDoc(doc(as('ann'), 'recommendation_log/r3'), rec({ ...shown, predicted: null })));
  await assertSucceeds(setDoc(doc(as('ann'), 'recommendation_log/r4'), rec({ ...shown, predicted: 'neutral' })));
  await assertSucceeds(setDoc(doc(as('ann'), 'recommendation_log/r5'), rec({ ...shown, predicted: 'negative' })));
});
await t('recommendation_log: bad new-field values are rejected', async () => {
  await assertFails(setDoc(doc(as('ann'), 'recommendation_log/b1'), rec({ ...shown, predicted: 'great' })));
  await assertFails(setDoc(doc(as('ann'), 'recommendation_log/b2'), rec({ ...shown, surface: 'billboard' })));
  await assertFails(setDoc(doc(as('ann'), 'recommendation_log/b3'), rec({ ...shown, rank: 1.5 })));
  await assertFails(setDoc(doc(as('ann'), 'recommendation_log/b4'), rec({ ...shown, rank: '1' })));
  await assertFails(setDoc(doc(as('ann'), 'recommendation_log/b5'), rec({ ...shown, setId: 42 })));
  await assertFails(setDoc(doc(as('ann'), 'recommendation_log/b6'), rec({ ...shown, shownAt: 'now' })));
});
await t('recommendation_log: cannot write as another user', () => assertFails(setDoc(doc(as('bob'), 'recommendation_log/x1'), rec(shown))));
await t('recommendation_log: write-once (no update), owner-only read and delete', async () => {
  await assertFails(updateDoc(doc(as('ann'), 'recommendation_log/r2'), { predicted: 'negative' }));
  await assertSucceeds(getDoc(doc(as('ann'), 'recommendation_log/r2')));
  await assertFails(getDoc(doc(as('bob'), 'recommendation_log/r2')));
  await assertFails(getDocs(query(collection(as('bob'), 'recommendation_log'), where('userId', '==', 'ann'))));
  await assertFails(deleteDoc(doc(as('bob'), 'recommendation_log/r2')));
  await assertSucceeds(deleteDoc(doc(as('ann'), 'recommendation_log/r2')));
});

console.log('pick marks on pick_feedback and reviews');
const pf = (o = {}) => ({ userId: 'ann', landmarkId: 'pm1', verdict: 'yes', at: Date.now(), ...o });
const mark = { pickSetId: 'ann-1-x', pickSurface: 'mapr-tab', pickShownAt: Date.now() };
const rv = (o = {}) => ({ userId: 'ann', landmarkId: 'pm1', stars: 5, ratingTier: 'highly-recommend', comment: '', hidden: false, visibility: 'private', ...o });
await t('pick_feedback: with and without pick marks both write; surface may be null', async () => {
  await assertSucceeds(setDoc(doc(as('ann'), 'pick_feedback/ann_pm1'), pf()));
  await assertSucceeds(setDoc(doc(as('ann'), 'pick_feedback/ann_pm1'), pf(mark)));
  await assertSucceeds(setDoc(doc(as('ann'), 'pick_feedback/ann_pm1'), pf({ ...mark, pickSurface: null })));
});
await t('pick_feedback: bad pick marks are refused', async () => {
  const db = as('ann');
  await assertFails(setDoc(doc(db, 'pick_feedback/ann_pm1'), pf({ ...mark, pickSurface: 'billboard' })));
  await assertFails(setDoc(doc(db, 'pick_feedback/ann_pm1'), pf({ ...mark, pickSetId: 5 })));
  await assertFails(setDoc(doc(db, 'pick_feedback/ann_pm1'), pf({ ...mark, pickSetId: 'x'.repeat(201) })));
  await assertFails(setDoc(doc(db, 'pick_feedback/ann_pm1'), pf({ ...mark, pickShownAt: 'yesterday' })));
});
await t('pick_feedback: marks do not loosen reads (still owner-only)', async () => {
  await assertSucceeds(getDoc(doc(as('ann'), 'pick_feedback/ann_pm1')));
  await assertFails(getDoc(doc(as('bob'), 'pick_feedback/ann_pm1')));
});
await t('reviews: pick marks accepted on create and edit; bad ones refused', async () => {
  const db = as('ann');
  await assertSucceeds(setDoc(doc(db, 'reviews/ann_pm1'), rv(mark)));
  await assertSucceeds(setDoc(doc(db, 'reviews/ann_pm1'), rv({ ...mark, comment: 'edit' })));
  await assertSucceeds(setDoc(doc(db, 'reviews/ann_pm2'), rv({ landmarkId: 'pm2' })));
  await assertFails(setDoc(doc(db, 'reviews/ann_pm3'), rv({ landmarkId: 'pm3', ...mark, pickSurface: 'other' })));
  await assertFails(setDoc(doc(db, 'reviews/ann_pm3'), rv({ landmarkId: 'pm3', ...mark, pickShownAt: 'x' })));
  await assertFails(setDoc(doc(db, 'reviews/ann_pm3'), rv({ landmarkId: 'pm3', ...mark, pickSetId: 'x'.repeat(201) })));
  await assertFails(updateDoc(doc(db, 'reviews/ann_pm1'), { pickSurface: 'nope' }));
});
await t('reviews: tier rule still applies with marks (no tier, still refused)', async () => {
  await assertFails(setDoc(doc(as('ann'), 'reviews/ann_pm4'), { userId: 'ann', landmarkId: 'pm4', comment: '', hidden: false, visibility: 'private', ...mark }));
});
await t('reviews: marks do not widen reads (private review stays hidden from others)', async () => {
  await assertFails(getDoc(doc(as('bob'), 'reviews/ann_pm1')));
});

console.log('place_scores (Mapr per-place score, owner-only)');
const ps = (o = {}) => ({
  landmarkId: 'pl1', region: 'miami', categories: ['food'], tap: 'positive', tapDelta: 4, tapAt: 1, rating: 'negative',
  ratingTier: 'probably-skip', ratingFrequency: null, ratingFactor: 0.5, ratingAt: 2, commentDeltas: { food: -3 },
  placeScore: -46, predicted: 'positive', outcome: 'negative', missWeight: 0.5, updatedAt: serverTimestamp(), ...o,
});
await t('place_scores: owner creates, updates, reads and deletes their own', async () => {
  const db = as('ann');
  await assertSucceeds(setDoc(doc(db, 'users/ann/place_scores/pl1'), ps()));
  await assertSucceeds(setDoc(doc(db, 'users/ann/place_scores/pl1'), ps({ tap: null, tapDelta: 0, placeScore: -30, missWeight: 0, predicted: null, outcome: null })));
  await assertSucceeds(getDoc(doc(db, 'users/ann/place_scores/pl1')));
  await assertSucceeds(getDocs(collection(db, 'users/ann/place_scores')));
});
await t('place_scores: nobody else can read, list, write or delete them', async () => {
  const db = as('bob');
  await assertFails(getDoc(doc(db, 'users/ann/place_scores/pl1')));
  await assertFails(getDocs(collection(db, 'users/ann/place_scores')));
  await assertFails(setDoc(doc(db, 'users/ann/place_scores/pl1'), ps()));
  await assertFails(deleteDoc(doc(db, 'users/ann/place_scores/pl1')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/ann/place_scores/pl1')));
});
await t('place_scores: unknown fields, wrong id, bad types and bad levels are refused', async () => {
  const db = as('ann');
  await assertFails(setDoc(doc(db, 'users/ann/place_scores/pl1'), ps({ isAdmin: true })));
  await assertFails(setDoc(doc(db, 'users/ann/place_scores/pl2'), ps()));
  await assertFails(setDoc(doc(db, 'users/ann/place_scores/pl1'), ps({ placeScore: 'high' })));
  await assertFails(setDoc(doc(db, 'users/ann/place_scores/pl1'), ps({ missWeight: null })));
  await assertFails(setDoc(doc(db, 'users/ann/place_scores/pl1'), ps({ tap: 'maybe' })));
});
await t('place_scores: owner can delete (account deletion)', () => assertSucceeds(deleteDoc(doc(as('ann'), 'users/ann/place_scores/pl1'))));

console.log('storage');
const stor = (uid) => env.authenticatedContext(uid, {}).storage();
await t('storage: signed-in can get a known file but cannot list a folder', async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await uploadBytes(ref(c.storage(), 'review_photos/lm/ann.jpg'), new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
  });
  await assertSucceeds(getBytes(ref(stor('bob'), 'review_photos/lm/ann.jpg')));
  await assertFails(listAll(ref(stor('bob'), 'review_photos/lm')));
  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), 'review_photos/lm/ann.jpg')));
  await assertSucceeds(uploadBytes(ref(stor('bob'), 'review_photos/lm/bob.jpg'), new Uint8Array([1]), { contentType: 'image/jpeg' }));
});

await env.cleanup();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
