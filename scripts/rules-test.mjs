// Emulator tests for firestore.rules / storage.rules (the access-tightening
// pass: private profile doc, bonus points, region_stats, streaks, referral,
// admin notifications, reply visibility, check-in reads).
//
// Not part of `npm test` (needs Java + the Firebase emulators). CI runs it
// (the `rules` job in .github/workflows/ci.yml). Run locally with:
//   npm run test:rules
// or by hand:
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
import { ref, getBytes, listAll, uploadBytes, deleteObject } from 'firebase/storage';

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

console.log('users: server-kept fields (Phase 2)');
await reset();
await seed((db) => setDoc(doc(db, 'users/sam'), { uid: 'sam', username: 'sam', followerCount: 3, reputation: { philly: 'local' } }));
await t('a client cannot set or change follower counts, reputation, levels, founding or badges on its own profile', async () => {
  const db = as('sam');
  for (const patch of [{ followerCount: 1000000 }, { followingCount: 5 }, { reputation: { philly: 'insider' } }, { founding: { philly: true } }, { levels: { philly: 'trusted' } }, { serverBadges: ['x'] }, { tipCount: 99 }]) {
    await assertFails(updateDoc(doc(db, 'users/sam'), patch));
  }
  await assertFails(setDoc(doc(as('new9'), 'users/new9'), { uid: 'new9', followerCount: 50 }));
});
await t('saving the profile with those fields unchanged still works', async () => {
  await assertSucceeds(setDoc(doc(as('sam'), 'users/sam'), { uid: 'sam', username: 'sam', followerCount: 3, reputation: { philly: 'local' }, displayName: 'Sam' }));
  await assertSucceeds(updateDoc(doc(as('sam'), 'users/sam'), { displayName: 'Sammy' }));
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
const ck = (over = {}) => ({ userId: 'erin', userName: 'e', landmarkId: 'lm', landmarkName: 'L', region: 'r', points: 0, basePoints: 100, visitNumber: 1, ratingOnly: false, visited: true, insideHomeRadius: false, createdAt: serverTimestamp(), ...over });
await t('signed-out users cannot read check-ins; the owner can', async () => {
  await seed((db) => setDoc(doc(db, 'checkins/erin_lm'), { userId: 'erin', points: 100 }));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'checkins/erin_lm')));
  await assertSucceeds(getDoc(doc(as('erin'), 'checkins/erin_lm')));
});
await t('Phase 2 read limits: a stranger cannot read a private profile\'s check-ins, one by one or as a list', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'users/erin'), { uid: 'erin', public: false });
    await setDoc(doc(db, 'checkins/erin_lm'), { userId: 'erin', points: 100, region: 'r', landmarkId: 'lm' });
  });
  await assertFails(getDoc(doc(as('bob'), 'checkins/erin_lm')));
  await assertFails(getDocs(query(collection(as('bob'), 'checkins'), where('userId', '==', 'erin'))));
});
await t('Phase 2 read limits: a friend reads them; so does anyone when the profile is public', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'friend_edges/fay_erin'), { owner: 'fay', friend: 'erin' });
    await setDoc(doc(db, 'users/gus'), { uid: 'gus', public: true });
    await setDoc(doc(db, 'checkins/gus_lm'), { userId: 'gus', points: 0, region: 'r', landmarkId: 'lm' });
  });
  await assertSucceeds(getDoc(doc(as('fay'), 'checkins/erin_lm')));
  await assertSucceeds(getDocs(query(collection(as('fay'), 'checkins'), where('userId', '==', 'erin'))));
  await assertSucceeds(getDoc(doc(as('bob'), 'checkins/gus_lm')));
  await assertSucceeds(getDocs(query(collection(as('bob'), 'checkins'), where('userId', '==', 'gus'))));
});
await t('Phase 2 read limits: a block either way hides a friend\'s or a public profile\'s check-ins', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'users/hal'), { uid: 'hal', public: true });
    await setDoc(doc(db, 'checkins/hal_lm'), { userId: 'hal', points: 0, region: 'r', landmarkId: 'lm' });
    await setDoc(doc(db, 'blocks/hal_ivy'), { blockerUid: 'hal', blockedUid: 'ivy' });
    await setDoc(doc(db, 'blocks/jon_hal'), { blockerUid: 'jon', blockedUid: 'hal' });
    await setDoc(doc(db, 'friend_edges/kim_erin'), { owner: 'kim', friend: 'erin' });
    await setDoc(doc(db, 'blocks/erin_kim'), { blockerUid: 'erin', blockedUid: 'kim' });
  });
  await assertFails(getDoc(doc(as('ivy'), 'checkins/hal_lm')));
  await assertFails(getDocs(query(collection(as('ivy'), 'checkins'), where('userId', '==', 'hal'))));
  await assertFails(getDoc(doc(as('jon'), 'checkins/hal_lm')));
  await assertFails(getDoc(doc(as('kim'), 'checkins/erin_lm')));
  await assertSucceeds(getDoc(doc(as('hal'), 'checkins/hal_lm')));
  await assertSucceeds(getDoc(doc(as('bob'), 'checkins/hal_lm')));
});
await t('Phase 2 read limits: queries across owners (by region or place) are refused, even for a friend', async () => {
  await assertFails(getDocs(query(collection(as('fay'), 'checkins'), where('region', '==', 'r'))));
  await assertFails(getDocs(query(collection(as('bob'), 'checkins'), where('landmarkId', 'in', ['lm']))));
});
await t('Phase 2 read limits: your own list and a get on your own missing id still work; the verified admin reads any', async () => {
  await assertSucceeds(getDocs(query(collection(as('erin'), 'checkins'), where('userId', '==', 'erin'))));
  await assertSucceeds(getDoc(doc(as('erin'), 'checkins/erin_nothere')));
  await assertFails(getDoc(doc(as('bob'), 'checkins/erin_nothere')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: true }).firestore(), 'checkins/erin_lm')));
});
// The paying check-in: the check-in, the payout marker and the three
// leaderboard entries in one write, as claimCheckIn does it.
const paidCheckin = (db, uid, id, over = {}, entryPoints = null, legacyId = false) => {
  const b = writeBatch(db);
  const pts = over.points ?? 100;
  b.set(doc(db, `checkins/${id}`), ck({ userId: uid, points: pts, ...over }));
  b.set(doc(db, `checkin_payouts/${uid}`), { checkinId: id, createdAt: serverTimestamp() });
  for (const [period, key] of [['weekly', '2026-W41'], ['monthly', '2026-10'], ['yearly', '2026']]) {
    b.set(doc(db, `leaderboard_entries/${period}_${key}_${uid}`), { userId: uid, userName: 'e', period, periodKey: key, points: increment(entryPoints ?? pts), ...(legacyId ? { lastCheckinId: id } : {}), updatedAt: serverTimestamp() }, { merge: true });
  }
  return b.commit();
};
await t('check-in payout: 0 always works, points need the one-time payout marker', async () => {
  const db = as('erin');
  await assertSucceeds(setDoc(doc(db, 'checkins/erin_a'), ck({ landmarkId: 'a' })));
  await assertSucceeds(setDoc(doc(db, 'checkins/erin_a_8'), ck({ landmarkId: 'a', visitNumber: 7, points: 0 })));
  // Points without the marker: denied, even on a first visit.
  await assertFails(setDoc(doc(db, 'checkins/erin_x'), ck({ landmarkId: 'x', points: 100 })));
  await assertFails(setDoc(doc(db, 'checkins/erin_b'), ck({ landmarkId: 'b', ratingOnly: true, points: 50 })));
  await assertSucceeds(setDoc(doc(db, 'checkins/erin_c'), ck({ landmarkId: 'c', ratingOnly: true, visited: false, points: 0 })));
});
await t('the first paying check-in works once, with its leaderboard entries', async () => {
  const db = as('erin');
  await assertSucceeds(paidCheckin(db, 'erin', 'erin_p1', { landmarkId: 'p1' }));
  // A second payout, at another place, is denied: the marker already exists.
  await assertFails(paidCheckin(db, 'erin', 'erin_p2', { landmarkId: 'p2' }));
  await assertFails(setDoc(doc(db, 'checkins/erin_p3'), ck({ landmarkId: 'p3', points: 100 })));
  // The marker can't be changed, removed, or read by others.
  await assertFails(setDoc(doc(db, 'checkin_payouts/erin'), { checkinId: 'erin_p4', createdAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(db, 'checkin_payouts/erin')));
  await assertSucceeds(getDoc(doc(db, 'checkin_payouts/erin')));
  await assertFails(getDoc(doc(as('bob'), 'checkin_payouts/erin')));
});
await t('payout marker: only alongside a new paying check-in of your own', async () => {
  await assertFails(setDoc(doc(as('fay'), 'checkin_payouts/fay'), { checkinId: 'fay_q', createdAt: serverTimestamp() }));
  await seed((db) => setDoc(doc(db, 'checkins/fay_old'), ck({ userId: 'fay', landmarkId: 'old', points: 100 })));
  await assertFails(setDoc(doc(as('fay'), 'checkin_payouts/fay'), { checkinId: 'fay_old', createdAt: serverTimestamp() }));
  await assertFails(paidCheckin(as('fay'), 'fay', 'fay_z', { landmarkId: 'z', points: 100 }, 200));
  await assertFails(paidCheckin(as('bob'), 'fay', 'fay_y', { landmarkId: 'y' }));
  // Visit taper still holds for the paying check-in.
  await assertFails(paidCheckin(as('fay'), 'fay', 'fay_w_3', { landmarkId: 'w', visitNumber: 3, points: 100 }));
  await assertSucceeds(paidCheckin(as('fay'), 'fay', 'fay_w', { landmarkId: 'w' }));
});
await t('Phase 2: no location numbers on a new check-in; old ones can only be removed by the owner', async () => {
  const db = as('erin');
  await assertFails(setDoc(doc(db, 'checkins/erin_loc1'), ck({ landmarkId: 'loc1', distanceMeters: 12, gpsAccuracyMeters: 8.5, verification: 'unverified' })));
  await assertFails(setDoc(doc(db, 'checkins/erin_loc1b'), ck({ landmarkId: 'loc1b', gpsAccuracyMeters: 8.5 })));
  await assertSucceeds(setDoc(doc(db, 'checkins/erin_loc2'), ck({ landmarkId: 'loc2', verification: 'unverified' })));
  await assertFails(setDoc(doc(db, 'checkins/erin_loc6'), ck({ landmarkId: 'loc6', verification: 'trusted' })));
  await assertFails(setDoc(doc(db, 'checkins/erin_loc7'), ck({ landmarkId: 'loc7', somethingElse: 1 })));
  // A check-in from before Phase 2 that still has them.
  await seed((sdb) => setDoc(doc(sdb, 'checkins/erin_loc8'), { ...ck({ landmarkId: 'loc8', verification: 'unverified' }), createdAt: 1, distanceMeters: 40, gpsAccuracyMeters: 9 }));
  // The owner can't set, change or null them, nor touch verification or points ...
  await assertFails(updateDoc(doc(db, 'checkins/erin_loc2'), { distanceMeters: 5 }));
  await assertFails(updateDoc(doc(db, 'checkins/erin_loc8'), { distanceMeters: 0 }));
  await assertFails(updateDoc(doc(db, 'checkins/erin_loc8'), { distanceMeters: null }));
  await assertFails(updateDoc(doc(db, 'checkins/erin_loc8'), { verification: 'verified' }));
  await assertFails(updateDoc(doc(db, 'checkins/erin_loc8'), { points: 500 }));
  // ... someone else can't scrub them ...
  await assertFails(updateDoc(doc(as('bob'), 'checkins/erin_loc8'), { distanceMeters: deleteField() }));
  // ... the owner can remove them (account deletion), and the usual fields still work.
  await assertSucceeds(updateDoc(doc(db, 'checkins/erin_loc8'), { distanceMeters: deleteField(), gpsAccuracyMeters: deleteField() }));
  await assertSucceeds(updateDoc(doc(db, 'checkins/erin_loc8'), { userName: 'Deleted User', photoURL: null }));
});

console.log('verified presence (Phase 0): server-written only');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'checkins/erin_v1'), ck({ landmarkId: 'v1', presence: { verified: false, reason: 'too-far', distanceMeters: 140 } }));
  await setDoc(doc(db, 'checkins/erin_v2'), ck({ landmarkId: 'v2', presence: { verified: true, distanceMeters: 4, accuracyMeters: 8 } }));
  await setDoc(doc(db, 'checkins/erin_v1/proof/main'), { uid: 'erin', lat: 1, lng: 2, accuracy: 9 });
  await setDoc(doc(db, 'presence_state/erin'), { lat: 1, lng: 2, atMs: 1 });
});
await t('a normal unverified check-in (with or without the field) still works', async () => {
  const db = as('erin');
  await assertSucceeds(setDoc(doc(db, 'checkins/erin_n1'), ck({ landmarkId: 'n1', verification: 'unverified' })));
  await assertSucceeds(setDoc(doc(db, 'checkins/erin_n2'), ck({ landmarkId: 'n2' })));
});
await t("a client can't create a check-in marked verified, or with presence", async () => {
  const db = as('erin');
  await assertFails(setDoc(doc(db, 'checkins/erin_f1'), ck({ landmarkId: 'f1', verification: 'verified' })));
  await assertFails(setDoc(doc(db, 'checkins/erin_f2'), ck({ landmarkId: 'f2', presence: { verified: true } })));
  await assertFails(setDoc(doc(db, 'checkins/erin_f3'), ck({ landmarkId: 'f3', presence: { verified: false } })));
});
await t("the owner can't set or change presence, or flip verification", async () => {
  const db = as('erin');
  await assertFails(updateDoc(doc(db, 'checkins/erin_n1'), { presence: { verified: true } }));
  await assertFails(updateDoc(doc(db, 'checkins/erin_v1'), { 'presence.verified': true }));
  await assertFails(updateDoc(doc(db, 'checkins/erin_v1'), { presence: { verified: true, distanceMeters: 1 } }));
  await assertFails(updateDoc(doc(db, 'checkins/erin_n1'), { verification: 'verified' }));
  // Other users and the admin can't either.
  await assertFails(updateDoc(doc(as('bob'), 'checkins/erin_n1'), { presence: { verified: true } }));
  await assertFails(updateDoc(doc(as('adm', { email: ADMIN_EMAIL }), 'checkins/erin_n1'), { presence: { verified: true } }));
});
await t('the owner may remove presence (account deletion) and still edit photos', async () => {
  const db = as('erin');
  await assertSucceeds(updateDoc(doc(db, 'checkins/erin_v2'), { userName: 'Deleted User', presence: deleteField() }));
  await assertSucceeds(updateDoc(doc(db, 'checkins/erin_v1'), { photoURL: null }));
});
await t('presence_metrics: only the admin dashboard reads it; nobody writes it', async () => {
  await seed((db) => setDoc(doc(db, 'presence_metrics/2026-10-10'), { checked: 1, verified: 1 }));
  const dash = env.authenticatedContext('admin-dashboard', { dashboardAdmin: true }).firestore();
  await assertSucceeds(getDoc(doc(dash, 'presence_metrics/2026-10-10')));
  await assertFails(setDoc(doc(dash, 'presence_metrics/2026-10-10'), { checked: 9 }));
  await assertFails(getDoc(doc(as('erin'), 'presence_metrics/2026-10-10')));
  await assertFails(getDoc(doc(as('adm', { email: ADMIN_EMAIL }), 'presence_metrics/2026-10-10')));
});
await t('GPS proof and the last verified fix are server-only, even for the owner', async () => {
  for (const db of [as('erin'), as('bob'), as('adm', { email: ADMIN_EMAIL })]) {
    await assertFails(getDoc(doc(db, 'checkins/erin_v1/proof/main')));
    await assertFails(getDocs(collection(db, 'checkins/erin_v1/proof')));
    await assertFails(setDoc(doc(db, 'checkins/erin_v1/proof/main'), { lat: 0 }));
    await assertFails(getDoc(doc(db, 'presence_state/erin')));
    await assertFails(setDoc(doc(db, 'presence_state/erin'), { lat: 0, lng: 0, atMs: 0 }));
  }
});

console.log('leaderboard_entries: a rise needs a payout in the same write');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'users/gus'), { uid: 'gus', username: 'gus', bonusPoints: 0 });
  await setDoc(doc(db, 'leaderboard_entries/weekly_2026-W41_gus'), { userId: 'gus', userName: 'g', period: 'weekly', periodKey: '2026-W41', points: 10, updatedAt: 1 });
  await setDoc(doc(db, 'checkins/gus_old'), { userId: 'gus', landmarkId: 'old', points: 100 });
});
const entry = (over = {}) => ({ userId: 'gus', userName: 'g', period: 'weekly', periodKey: '2026-W41', points: increment(100), updatedAt: serverTimestamp(), ...over });
await t('a bare +100 on an entry is denied (create or update)', async () => {
  const db = as('gus');
  await assertFails(setDoc(doc(db, 'leaderboard_entries/weekly_2026-W41_gus'), entry(), { merge: true }));
  await assertFails(setDoc(doc(db, 'leaderboard_entries/monthly_2026-10_gus'), entry({ period: 'monthly', periodKey: '2026-10', points: 100 })));
});
await t('naming an old check-in, or someone else\'s, does not pay', async () => {
  const db = as('gus');
  await assertFails(setDoc(doc(db, 'leaderboard_entries/weekly_2026-W41_gus'), entry({ lastCheckinId: 'gus_old' }), { merge: true }));
  await seed((sdb) => setDoc(doc(sdb, 'checkins/hal_x'), { userId: 'hal', landmarkId: 'x', points: 100 }));
  await assertFails(setDoc(doc(db, 'leaderboard_entries/weekly_2026-W41_gus'), entry({ lastCheckinId: 'hal_x' }), { merge: true }));
});
await t('Phase 2: the payout doc proves a rise, no public lastCheckinId needed; a build that still sends it works; it never pays twice', async () => {
  await assertSucceeds(paidCheckin(as('lia'), 'lia', 'lia_lm'));
  await assertSucceeds(paidCheckin(as('max'), 'max', 'max_lm', {}, null, true));
  // The payout doc exists now: no new rise, with or without naming a check-in.
  await assertFails(setDoc(doc(as('lia'), 'leaderboard_entries/weekly_2026-W41_lia'), { userId: 'lia', userName: 'l', period: 'weekly', periodKey: '2026-W41', points: increment(100), lastCheckinId: 'lia_lm', updatedAt: serverTimestamp() }, { merge: true }));
});
await t('Phase 2: the owner can take lastCheckinId off an entry (no rise), so it doesn\'t stay public', async () => {
  await seed((db) => setDoc(doc(db, 'leaderboard_entries/weekly_2026-W41_ken'), { userId: 'ken', userName: 'k', period: 'weekly', periodKey: '2026-W41', points: 100, lastCheckinId: 'ken_lm', updatedAt: 1 }));
  await assertSucceeds(updateDoc(doc(as('ken'), 'leaderboard_entries/weekly_2026-W41_ken'), { lastCheckinId: deleteField() }));
  await assertFails(updateDoc(doc(as('bob'), 'leaderboard_entries/weekly_2026-W41_ken'), { lastCheckinId: deleteField() }));
});
await t('name and timestamp updates with no rise still work', () =>
  assertSucceeds(updateDoc(doc(as('gus'), 'leaderboard_entries/weekly_2026-W41_gus'), { userName: 'Gus', updatedAt: serverTimestamp() })));
await t('onboarding bonus: +10 entries batched with the +10 bonus and the flag', async () => {
  const db = as('gus');
  const mk = (pts) => {
    const b = writeBatch(db);
    b.set(doc(db, 'users/gus'), { onboardingCompleted: true, bonusPoints: increment(10) }, { merge: true });
    b.set(doc(db, 'leaderboard_entries/weekly_2026-W41_gus'), entry({ points: increment(pts) }), { merge: true });
    b.set(doc(db, 'leaderboard_entries/yearly_2026_gus'), entry({ period: 'yearly', periodKey: '2026', points: increment(pts) }), { merge: true });
    return b;
  };
  await assertFails(mk(100).commit());
  await assertSucceeds(mk(10).commit());
  // Done once: the flag is set, so the bonus and its entries can't repeat.
  await assertFails(mk(10).commit());
});

console.log('region_stats');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'checkins/erin_lm1'), { userId: 'erin', points: 100 });
  await setDoc(doc(db, 'region_stats/miami'), { counts: { lm1: 3 }, backfilled: true });
});
await t('Phase 2: region_stats is server-written; no client bumps, stamps or deletes it, even with a check-in there', async () => {
  const db = as('erin');
  await assertFails(setDoc(doc(db, 'region_stats/miami'), { counts: { lm1: increment(1) }, lastBump: 'lm1', updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(doc(db, 'region_stats/newregion'), { counts: { lm1: increment(1) }, lastBump: 'lm1', updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(doc(as('bob'), 'region_stats/miami'), { counts: { lm1: 12, lm9: 3 }, backfilled: true, updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(deleteDoc(doc(db, 'region_stats/miami')));
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
  const unverified = env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: false }).firestore();
  await assertFails(setDoc(doc(unverified, 'admin_pointer/current'), { uid: 'adm', updatedAt: serverTimestamp() }));
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
  await assertSucceeds(getDocs(collection(env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: true }).firestore(), 'reviews/ivy_hid/replies')));
});
await t('an unverified account using the admin email is not the admin', () =>
  assertFails(getDocs(collection(env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: false }).firestore(), 'reviews/ivy_hid/replies'))));
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
  await assertSucceeds(setDoc(doc(as('ann'), 'recommendation_log/b2tp'), rec({ ...shown, surface: 'travel-picks' })));
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
await t('pick_feedback: a chat pick vote with requestFor and marks writes (no rules change needed); other users still cannot write it', async () => {
  await assertSucceeds(setDoc(doc(as('ann'), 'pick_feedback/ann_pm1'), pf({ ...mark, pickSurface: 'chat', requestFor: 'group', verdict: 'unsure' })));
  await assertFails(setDoc(doc(as('bob'), 'pick_feedback/ann_pm1'), pf({ ...mark, requestFor: 'group' })));
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

console.log('taste_history (score snapshots, owner-only) and recommendation_log.requestFor');
const th = (o = {}) => ({
  at: Date.now(), score: 80, percent: 80.5, guesses: 20, totalGuesses: 24, window: 20, hits: 14, smallMisses: 4,
  bigMisses: 1, halfMisses: 1, baselineScore: 60, baselineLevel: 'positive', ratingsCount: 30, version: 1,
  createdAt: serverTimestamp(), ...o,
});
await t('taste_history: owner creates (null score allowed), reads, lists and deletes', async () => {
  const db = as('ann');
  await assertSucceeds(setDoc(doc(db, 'users/ann/taste_history/h1'), th()));
  await assertSucceeds(setDoc(doc(db, 'users/ann/taste_history/h2'), th({ score: null, baselineScore: null, baselineLevel: null })));
  await assertSucceeds(getDoc(doc(db, 'users/ann/taste_history/h1')));
  await assertSucceeds(getDocs(collection(db, 'users/ann/taste_history')));
});
await t('taste_history: nobody else can read, list, create or delete', async () => {
  const db = as('bob');
  await assertFails(getDoc(doc(db, 'users/ann/taste_history/h1')));
  await assertFails(getDocs(collection(db, 'users/ann/taste_history')));
  await assertFails(setDoc(doc(db, 'users/ann/taste_history/h3'), th()));
  await assertFails(deleteDoc(doc(db, 'users/ann/taste_history/h1')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/ann/taste_history/h1')));
});
await t('taste_history: a snapshot is never edited, and bad shapes are refused', async () => {
  const db = as('ann');
  await assertFails(updateDoc(doc(db, 'users/ann/taste_history/h1'), { score: 100 }));
  await assertFails(setDoc(doc(db, 'users/ann/taste_history/h1'), th({ score: 100 })));
  await assertFails(setDoc(doc(db, 'users/ann/taste_history/h4'), th({ isAdmin: true })));
  await assertFails(setDoc(doc(db, 'users/ann/taste_history/h5'), th({ score: 101 })));
  await assertFails(setDoc(doc(db, 'users/ann/taste_history/h6'), th({ score: 'high' })));
  await assertFails(setDoc(doc(db, 'users/ann/taste_history/h7'), th({ ratingsCount: 1.5 })));
});
await t('taste_history: owner can delete (account deletion)', () => assertSucceeds(deleteDoc(doc(as('ann'), 'users/ann/taste_history/h1'))));
await t('recommendation_log: requestFor accepts solo and group only', async () => {
  await assertSucceeds(setDoc(doc(as('ann'), 'recommendation_log/rf1'), rec({ ...shown, requestFor: 'solo' })));
  await assertSucceeds(setDoc(doc(as('ann'), 'recommendation_log/rf2'), rec({ ...shown, requestFor: 'group' })));
  await assertFails(setDoc(doc(as('ann'), 'recommendation_log/rf3'), rec({ ...shown, requestFor: 'family' })));
  await assertFails(setDoc(doc(as('ann'), 'recommendation_log/rf4'), rec({ ...shown, requestFor: null })));
});

console.log('re-rating fields on reviews (ratedAt, priorTier, priorRatedAt, disagreement)');
const dis = (o = {}) => ({ reason: 'food', comment: 'cold fries', at: Date.now(), source: 'asked', ...o });
await t('reviews: re-rating fields accepted on create and on a re-rating edit', async () => {
  const db = as('ann');
  await assertSucceeds(setDoc(doc(db, 'reviews/ann_rr1'), rv({ landmarkId: 'rr1', ratedAt: 1000 })));
  await assertSucceeds(setDoc(doc(db, 'reviews/ann_rr1'), rv({ landmarkId: 'rr1', ratedAt: 1000, ratingTier: 'probably-skip', stars: 1, priorTier: 'highly-recommend', priorRatedAt: 1000, disagreement: dis() })));
  await assertSucceeds(setDoc(doc(db, 'reviews/ann_rr1'), rv({ landmarkId: 'rr1', ratedAt: 1000, priorTier: 'probably-skip', priorRatedAt: 2000, disagreement: null })));
});
await t('reviews: every allowed disagreement reason is accepted', async () => {
  const db = as('ann');
  for (const reason of ['food', 'service', 'price', 'noise-crowd', 'changed-mind', 'one-off', 'wrong-type', 'other', 'skip']) {
    await assertSucceeds(setDoc(doc(db, 'reviews/ann_rr2'), rv({ landmarkId: 'rr2', ratedAt: 1, disagreement: dis({ reason }) })));
  }
  await assertSucceeds(setDoc(doc(db, 'reviews/ann_rr2'), rv({ landmarkId: 'rr2', ratedAt: 1, disagreement: { reason: 'skip', comment: '', at: 5 } })));
});
await t('reviews: bad re-rating fields are refused (reason, comment length, types, extra keys)', async () => {
  const db = as('ann');
  const bad = (o) => assertFails(setDoc(doc(db, 'reviews/ann_rr3'), rv({ landmarkId: 'rr3', ...o })));
  await bad({ disagreement: dis({ reason: 'because' }) });
  await bad({ disagreement: dis({ comment: 'x'.repeat(501) }) });
  await bad({ disagreement: dis({ comment: 5 }) });
  await bad({ disagreement: dis({ at: 'now' }) });
  await bad({ disagreement: { ...dis(), isAdmin: true } });
  await bad({ disagreement: 'food' });
  await bad({ ratedAt: 'yesterday' });
  await bad({ priorTier: 'meh' });
  await bad({ priorRatedAt: 'x' });
  await assertSucceeds(setDoc(doc(db, 'reviews/ann_rr3'), rv({ landmarkId: 'rr3', disagreement: dis({ comment: 'x'.repeat(500) }) })));
});
await t('reviews: ratedAt can be added once to an old review, then never changed', async () => {
  const db = as('ann');
  await seed((adb) => setDoc(doc(adb, 'reviews/ann_rr4'), rv({ landmarkId: 'rr4' })));
  await assertSucceeds(setDoc(doc(db, 'reviews/ann_rr4'), rv({ landmarkId: 'rr4', ratedAt: 500 })));
  await assertFails(setDoc(doc(db, 'reviews/ann_rr4'), rv({ landmarkId: 'rr4', ratedAt: 600 })));
  await assertFails(setDoc(doc(db, 'reviews/ann_rr4'), rv({ landmarkId: 'rr4' })));
  await assertSucceeds(setDoc(doc(db, 'reviews/ann_rr4'), rv({ landmarkId: 'rr4', ratedAt: 500, comment: 'edit' })));
  await assertSucceeds(updateDoc(doc(db, 'reviews/ann_rr4'), { visibility: 'public', hidden: false }));
});
await t('reviews: the new fields do not loosen reads or the tier rule', async () => {
  await assertFails(getDoc(doc(as('bob'), 'reviews/ann_rr1')));
  await assertFails(setDoc(doc(as('ann'), 'reviews/ann_rr5'), { userId: 'ann', landmarkId: 'rr5', comment: '', hidden: false, visibility: 'private', ratedAt: 1, disagreement: dis() }));
  await assertFails(setDoc(doc(as('bob'), 'reviews/ann_rr1'), rv({ landmarkId: 'rr1', ratedAt: 1 })));
});
await t('account deletion: the owner can delete a review carrying the new fields, nobody else can', async () => {
  const id = 'reviews/ann_rr6';
  await seed((adb) => setDoc(doc(adb, id), rv({ landmarkId: 'rr6', ratedAt: 1, priorTier: 'highly-recommend', priorRatedAt: 1, disagreement: dis() })));
  await assertFails(deleteDoc(doc(as('bob'), id)));
  await assertSucceeds(deleteDoc(doc(as('ann'), id)));
  await seed(async (adb) => { if ((await getDoc(doc(adb, id))).exists()) throw new Error('review still there'); });
});
await t('place_scores: new ledger fields (type effect, resolution, latest answer) accepted; bad ones refused', async () => {
  const db = as('ann');
  const extra = { tapPlaceOff: true, typeTier: null, typeFrequency: null, typeFactor: 1, typeDelta: 3.4, placeRatingDelta: -6, resolution: 'skip', latestLevel: 'negative', latestSource: 'rating', latestAt: 5, commentTypeDeltas: {} };
  await assertSucceeds(setDoc(doc(db, 'users/ann/place_scores/pl9'), ps({ landmarkId: 'pl9', ...extra })));
  await assertFails(setDoc(doc(db, 'users/ann/place_scores/pl9'), ps({ landmarkId: 'pl9', ...extra, latestLevel: 'meh' })));
  await assertFails(setDoc(doc(db, 'users/ann/place_scores/pl9'), ps({ landmarkId: 'pl9', ...extra, resolution: 'because' })));
  await assertFails(setDoc(doc(db, 'users/ann/place_scores/pl9'), ps({ landmarkId: 'pl9', ...extra, latestSource: 'chat' })));
  await assertFails(getDoc(doc(as('bob'), 'users/ann/place_scores/pl9')));
});

console.log('item 8: createdAt, open_days, study_summaries');
await reset();
await t('createdAt: owner sets it once (server time) on a profile without one', async () => {
  const db = as('nina');
  await assertSucceeds(setDoc(doc(db, 'users/nina'), { uid: 'nina', onboardingSource: 'signup', createdAt: serverTimestamp() }, { merge: true }));
});
await t('createdAt: cannot be changed, removed or set to a made-up time afterwards', async () => {
  const db = as('nina');
  await assertFails(setDoc(doc(db, 'users/nina'), { createdAt: serverTimestamp() }, { merge: true }));
  await assertFails(updateDoc(doc(db, 'users/nina'), { createdAt: deleteField() }));
  await assertFails(updateDoc(doc(db, 'users/nina'), { createdAt: new Date(2020, 1, 1) }));
  await assertSucceeds(setDoc(doc(db, 'users/nina'), { displayName: 'Nina', updatedAt: serverTimestamp() }, { merge: true }));
});
await t('createdAt: a made-up time is refused even the first time; someone else cannot set it', async () => {
  await seed((adb) => setDoc(doc(adb, 'users/omar'), { uid: 'omar' }));
  await assertFails(setDoc(doc(as('omar'), 'users/omar'), { createdAt: new Date(2020, 1, 1) }, { merge: true }));
  await assertFails(setDoc(doc(as('nina'), 'users/omar'), { createdAt: serverTimestamp() }, { merge: true }));
});
await t('createdAt: a profile that already has one (backfilled) keeps it', async () => {
  await seed((adb) => setDoc(doc(adb, 'users/pia'), { uid: 'pia', createdAt: new Date(2024, 0, 1) }));
  await assertFails(setDoc(doc(as('pia'), 'users/pia'), { createdAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(setDoc(doc(as('pia'), 'users/pia'), { displayName: 'Pia' }, { merge: true }));
});
await t('open_days: owner creates today once; a second write for the same day is refused', async () => {
  const db = as('quin');
  await assertSucceeds(setDoc(doc(db, 'users/quin/open_days/2026-10-01'), { userId: 'quin', date: '2026-10-01', createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, 'users/quin/open_days/2026-10-01'), { userId: 'quin', date: '2026-10-01', createdAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'users/quin/open_days/2026-10-01'), { date: '2026-10-01' }));
});
await t('open_days: no extra fields (no location), id must match the date, userId must be the owner', async () => {
  const db = as('quin');
  await assertFails(setDoc(doc(db, 'users/quin/open_days/2026-10-02'), { userId: 'quin', date: '2026-10-02', createdAt: serverTimestamp(), lat: 1 }));
  await assertFails(setDoc(doc(db, 'users/quin/open_days/2026-10-03'), { userId: 'quin', date: '2026-10-04', createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, 'users/quin/open_days/today'), { userId: 'quin', date: 'today', createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, 'users/quin/open_days/2026-10-05'), { userId: 'rex', date: '2026-10-05', createdAt: serverTimestamp() }));
});
await t('open_days: owner-only (others cannot read, create or delete); owner can delete', async () => {
  await assertFails(getDoc(doc(as('rex'), 'users/quin/open_days/2026-10-01')));
  await assertFails(setDoc(doc(as('rex'), 'users/quin/open_days/2026-10-06'), { userId: 'quin', date: '2026-10-06', createdAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(as('rex'), 'users/quin/open_days/2026-10-01')));
  await assertSucceeds(getDoc(doc(as('quin'), 'users/quin/open_days/2026-10-01')));
  await assertSucceeds(deleteDoc(doc(as('quin'), 'users/quin/open_days/2026-10-01')));
});
await t('study_summaries: denied to everyone, the admin account included', async () => {
  await seed((adb) => setDoc(doc(adb, 'study_summaries/2026-10-01'), { date: '2026-10-01' }));
  for (const db of [as('quin'), as('admin1', { email: ADMIN_EMAIL }), env.unauthenticatedContext().firestore()]) {
    await assertFails(getDoc(doc(db, 'study_summaries/2026-10-01')));
    await assertFails(setDoc(doc(db, 'study_summaries/2026-10-02'), { date: '2026-10-02' }));
    await assertFails(deleteDoc(doc(db, 'study_summaries/2026-10-01')));
  }
});

console.log('place_ids (server-only Google place-ID cache)');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'place_ids/sf__lm1'), { placeId: 'ChIJx', matchedName: 'Liberty Bell', lat: 1, lng: 2, status: 'ok', source: 'text-search' });
});
await t('place_ids: no client (signed out, user, admin) can read, list, write or delete', async () => {
  for (const db of [as('alice'), as('alice', { email: ADMIN_EMAIL }), env.unauthenticatedContext().firestore()]) {
    await assertFails(getDoc(doc(db, 'place_ids/sf__lm1')));
    await assertFails(getDocs(collection(db, 'place_ids')));
    await assertFails(setDoc(doc(db, 'place_ids/sf__lm2'), { placeId: 'x' }));
    await assertFails(setDoc(doc(db, 'place_ids/sf__lm1'), { placeId: 'evil' }));
    await assertFails(deleteDoc(doc(db, 'place_ids/sf__lm1')));
  }
});

console.log('place_backfill_usage (server-only daily counter)');
await t('place_backfill_usage: no client (signed out, user, admin) can read, list, write or delete', async () => {
  for (const db of [as('alice'), as('alice', { email: ADMIN_EMAIL }), env.unauthenticatedContext().firestore()]) {
    await assertFails(getDoc(doc(db, 'place_backfill_usage/2026-10-02')));
    await assertFails(getDocs(collection(db, 'place_backfill_usage')));
    await assertFails(setDoc(doc(db, 'place_backfill_usage/2026-10-02'), { searches: 0 }));
    await assertFails(deleteDoc(doc(db, 'place_backfill_usage/2026-10-02')));
  }
});

console.log('custom_landmarks: list for everyone, get hides reported pins');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'custom_landmarks/ok'), { name: 'Ok pin', createdBy: 'alice', reportedBy: [] });
  await setDoc(doc(db, 'custom_landmarks/bad'), { name: 'Reported pin', createdBy: 'alice', reportedBy: ['x', 'y'] });
});
await t('a normal user can list custom landmarks (the app filters reported ones)', () => assertSucceeds(getDocs(collection(as('bob'), 'custom_landmarks'))));
await t('signed out can list custom landmarks', () => assertSucceeds(getDocs(collection(env.unauthenticatedContext().firestore(), 'custom_landmarks'))));
await t('a reported pin cannot be fetched by someone else', () => assertFails(getDoc(doc(as('bob'), 'custom_landmarks/bad'))));
await t('its creator can still fetch it', () => assertSucceeds(getDoc(doc(as('alice'), 'custom_landmarks/bad'))));

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
await t('storage: only a verified admin email can delete someone else\'s photo', async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await uploadBytes(ref(c.storage(), 'review_photos/lm/ann.jpg'), new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
  });
  const fake = env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: false }).storage();
  await assertFails(deleteObject(ref(fake, 'review_photos/lm/ann.jpg')));
  const real = env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: true }).storage();
  await assertSucceeds(deleteObject(ref(real, 'review_photos/lm/ann.jpg')));
});

console.log('group trips: live location');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'group_trips/trip1'), { ownerUid: 'alice', memberUids: ['alice', 'bob'], memberNames: { alice: 'Alice', bob: 'Bob' }, name: 'Trip', regionId: 'miami', landmarkIds: [] });
});
const live = (uid, extra = {}) => ({ uid, name: uid, lat: 25.77, lng: -80.19, accuracy: 10, mode: 'timed', expiresAt: Date.now() + 60 * 60 * 1000, updatedAt: serverTimestamp(), ...extra });
await t('a member shares their own live location', () => assertSucceeds(setDoc(doc(as('alice'), 'group_trips/trip1/live_locations/alice'), live('alice'))));
await t('another member can see it', () => assertSucceeds(getDoc(doc(as('bob'), 'group_trips/trip1/live_locations/alice'))));
await t('another member can list everyone sharing', () => assertSucceeds(getDocs(collection(as('bob'), 'group_trips/trip1/live_locations'))));
await t('someone not on the trip cannot see it', () => assertFails(getDoc(doc(as('carol'), 'group_trips/trip1/live_locations/alice'))));
await t('nobody can write another member\'s location', () => assertFails(setDoc(doc(as('bob'), 'group_trips/trip1/live_locations/alice'), live('alice'))));
await t('a non-member cannot share into the trip', () => assertFails(setDoc(doc(as('carol'), 'group_trips/trip1/live_locations/carol'), live('carol'))));
await t('a member can share and then update their own location', async () => {
  await assertSucceeds(setDoc(doc(as('bob'), 'group_trips/trip1/live_locations/bob'), live('bob', { mode: 'viewing', expiresAt: Date.now() + 2 * 60 * 1000 })));
  await assertSucceeds(setDoc(doc(as('bob'), 'group_trips/trip1/live_locations/bob'), live('bob', { lat: 25.78, accuracy: null })));
});
await t('a share cannot run past 8 hours', () => assertFails(setDoc(doc(as('bob'), 'group_trips/trip1/live_locations/bob'), live('bob', { expiresAt: Date.now() + 9 * 60 * 60 * 1000 }))));
await t('extra fields are refused', () => assertFails(setDoc(doc(as('bob'), 'group_trips/trip1/live_locations/bob'), live('bob', { note: 'x' }))));
await t('only the sharer can stop it', async () => {
  await assertFails(deleteDoc(doc(as('bob'), 'group_trips/trip1/live_locations/alice')));
  await assertSucceeds(deleteDoc(doc(as('alice'), 'group_trips/trip1/live_locations/alice')));
});

console.log('tips (Phase 1)');
await reset();
const tip = (authorUid, landmarkId, extra = {}) => ({ authorUid, authorName: authorUid, landmarkId, region: 'philly', checkinId: `${authorUid}_${landmarkId}`, visitAt: 1, text: 'Go early, the line wraps the block by noon.', tags: [], photoURL: null, status: 'live', hidden: false, reportedBy: [], counts: { helpful: 0, saved: 0 }, createdAt: 1, ...extra });
await seed(async (db) => {
  await setDoc(doc(db, 'tips/ann_lm1'), tip('ann', 'lm1'));
  await setDoc(doc(db, 'tips/ann_lm2'), tip('ann', 'lm2', { status: 'held' }));
  await setDoc(doc(db, 'tips/ann_lm3'), tip('ann', 'lm3', { hidden: true, reportedBy: ['x', 'y'] }));
  await setDoc(doc(db, 'tips/ann_lm4'), tip('ann', 'lm4', { status: 'removed' }));
  await setDoc(doc(db, 'tips/bob_lm1'), tip('bob', 'lm1'));
  await setDoc(doc(db, 'blocks/ann_cat'), { blockerUid: 'ann', blockedUid: 'cat' });
  await setDoc(doc(db, 'blocks/dan_ann'), { blockerUid: 'dan', blockedUid: 'ann' });
  await setDoc(doc(db, 'tip_reactions/bob_ann_lm1'), { uid: 'bob', tipId: 'ann_lm1', helpful: true, saved: false });
  await setDoc(doc(db, 'tip_views/bob_ann_lm1'), { uid: 'bob', tipId: 'ann_lm1', at: 1 });
});
await t("tips: nobody else reads a tip straight from Firestore, live or not, signed in or out (api/tips.js serves them)", async () => {
  for (const id of ['ann_lm1', 'ann_lm2', 'ann_lm3', 'ann_lm4']) await assertFails(getDoc(doc(as('bob'), `tips/${id}`)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'tips/ann_lm1')));
});
await t('tips: the author reads their own held, hidden and removed tips', async () => {
  for (const id of ['ann_lm1', 'ann_lm2', 'ann_lm3', 'ann_lm4']) await assertSucceeds(getDoc(doc(as('ann'), `tips/${id}`)));
});
await t('tips: the verified admin reads a held tip; an unverified admin email does not', async () => {
  await assertSucceeds(getDoc(doc(env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: true }).firestore(), 'tips/ann_lm2')));
  await assertFails(getDoc(doc(env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: false }).firestore(), 'tips/ann_lm2')));
});
await t('tips: a get on your own tip id before it exists is a clean not-found; on someone else\'s missing id it is denied', async () => {
  await assertSucceeds(getDoc(doc(as('bob'), 'tips/bob_lm77')));
  await assertFails(getDoc(doc(as('bob'), 'tips/ann_lm77')));
});
await t('tips: you can list your own tips, not anyone else\'s or everyone\'s', async () => {
  await assertSucceeds(getDocs(query(collection(as('ann'), 'tips'), where('authorUid', '==', 'ann'))));
  await assertFails(getDocs(query(collection(as('bob'), 'tips'), where('authorUid', '==', 'ann'))));
  await assertFails(getDocs(query(collection(as('bob'), 'tips'), where('landmarkId', '==', 'lm1'), where('status', '==', 'live'))));
});
await t('tips: no client creates, edits, reports into or deletes a tip (server only)', async () => {
  await assertFails(setDoc(doc(as('bob'), 'tips/bob_lm9'), tip('bob', 'lm9')));
  await assertFails(updateDoc(doc(as('ann'), 'tips/ann_lm1'), { text: 'changed text here' }));
  await assertFails(updateDoc(doc(as('ann'), 'tips/ann_lm2'), { status: 'live' }));
  await assertFails(updateDoc(doc(as('bob'), 'tips/ann_lm1'), { reportedBy: ['bob'] }));
  await assertFails(updateDoc(doc(as('ann'), 'tips/ann_lm1'), { counts: { helpful: 999, saved: 0 } }));
  await assertFails(deleteDoc(doc(as('ann'), 'tips/ann_lm1')));
});
await t('tip_reactions: owner reads own marks; others cannot; nobody writes', async () => {
  await assertSucceeds(getDoc(doc(as('bob'), 'tip_reactions/bob_ann_lm1')));
  await assertSucceeds(getDocs(query(collection(as('bob'), 'tip_reactions'), where('uid', '==', 'bob'))));
  await assertFails(getDoc(doc(as('ann'), 'tip_reactions/bob_ann_lm1')));
  await assertFails(getDocs(query(collection(as('ann'), 'tip_reactions'), where('tipId', '==', 'ann_lm1'))));
  await assertFails(setDoc(doc(as('bob'), 'tip_reactions/bob_ann_lm1'), { uid: 'bob', tipId: 'ann_lm1', helpful: true, saved: true }));
  await assertFails(deleteDoc(doc(as('bob'), 'tip_reactions/bob_ann_lm1')));
});
await t('tip_views: server only, even for the viewer and the author', async () => {
  await assertFails(getDoc(doc(as('bob'), 'tip_views/bob_ann_lm1')));
  await assertFails(getDoc(doc(as('ann'), 'tip_views/bob_ann_lm1')));
  await assertFails(setDoc(doc(as('bob'), 'tip_views/bob_x'), { uid: 'bob' }));
});
await t("recommendation_log: 'landmark-page' is an allowed surface; unknown surfaces still fail", async () => {
  await assertSucceeds(setDoc(doc(as('bob'), 'recommendation_log/lp1'), { userId: 'bob', landmarkId: 'lm1', pickType: null, surface: 'landmark-page', setId: 's1', rank: 1, shownAt: 1 }));
  await assertFails(setDoc(doc(as('bob'), 'recommendation_log/lp2'), { userId: 'bob', landmarkId: 'lm1', pickType: null, surface: 'tips-anywhere' }));
});
await t('storage tip_photos: owner uploads an image under 5 MB in their own folder', () =>
  assertSucceeds(uploadBytes(ref(stor('ann'), 'tip_photos/ann/t1.jpg'), new Uint8Array([1, 2]), { contentType: 'image/jpeg' })));
await t('storage tip_photos: no upload into someone else\'s folder, no 5 MB file, no non-image', async () => {
  await assertFails(uploadBytes(ref(stor('bob'), 'tip_photos/ann/t2.jpg'), new Uint8Array([1]), { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(stor('ann'), 'tip_photos/ann/big.jpg'), new Uint8Array(5 * 1024 * 1024), { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(stor('ann'), 'tip_photos/ann/x.jpg'), new Uint8Array([1]), { contentType: 'image/svg+xml' }));
  await assertFails(uploadBytes(ref(stor('ann'), 'tip_photos/ann/x.html'), new Uint8Array([1]), { contentType: 'image/jpeg' }));
});
await t('storage tip_photos: signed-in get works, list and signed-out get do not', async () => {
  await assertSucceeds(getBytes(ref(stor('bob'), 'tip_photos/ann/t1.jpg')));
  await assertFails(listAll(ref(stor('bob'), 'tip_photos/ann')));
  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), 'tip_photos/ann/t1.jpg')));
});
await t('storage tip_photos: no client overwrites or deletes a photo, its owner included; the admin can delete', async () => {
  await assertFails(uploadBytes(ref(stor('ann'), 'tip_photos/ann/t1.jpg'), new Uint8Array([9, 9]), { contentType: 'image/jpeg' }));
  await assertFails(deleteObject(ref(stor('bob'), 'tip_photos/ann/t1.jpg')));
  await assertFails(deleteObject(ref(stor('ann'), 'tip_photos/ann/t1.jpg')));
  await assertSucceeds(deleteObject(ref(env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: true }).storage(), 'tip_photos/ann/t1.jpg')));
});

console.log('tip_metrics (Phase 1 dashboard)');
await reset();
await seed((db) => setDoc(doc(db, 'tip_metrics/2026-10-12'), { date: '2026-10-12', live: 1 }));
await t('tip_metrics: only the admin dashboard reads it; no app user, not even the admin account, and nobody writes', async () => {
  await assertSucceeds(getDoc(doc(env.authenticatedContext('admin-dashboard', { dashboardAdmin: true }).firestore(), 'tip_metrics/2026-10-12')));
  await assertFails(getDoc(doc(as('ann'), 'tip_metrics/2026-10-12')));
  await assertFails(getDoc(doc(env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: true }).firestore(), 'tip_metrics/2026-10-12')));
  await assertFails(setDoc(doc(env.authenticatedContext('admin-dashboard', { dashboardAdmin: true }).firestore(), 'tip_metrics/x'), { live: 9 }));
});
await t('tip_reports, tip_post_log, tip_photo_claims: server only', async () => {
  await assertFails(getDoc(doc(as('ann'), 'tip_reports/x_g_ann')));
  await assertFails(setDoc(doc(as('ann'), 'tip_reports/x_g_ann'), { uid: 'ann' }));
  await assertFails(getDoc(doc(as('ann'), 'tip_post_log/ann')));
  await assertFails(setDoc(doc(as('ann'), 'tip_post_log/ann'), { at: [] }));
  await assertFails(setDoc(doc(as('ann'), 'tip_photo_claims/tip_photos__ann__a.jpg'), { uid: 'ann' }));
});

console.log('follows (Phase 2)');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'follows/ann_pub'), { followerUid: 'ann', followeeUid: 'pub', createdAtMs: 1 });
  await setDoc(doc(db, 'follows/bob_pub'), { followerUid: 'bob', followeeUid: 'pub', createdAtMs: 1 });
  await setDoc(doc(db, 'follow_log/ann'), { at: [1] });
  await setDoc(doc(db, 'users/pub'), { uid: 'pub', public: true, followerCount: 2 });
});
await t('follows: you read the follows you made and the ones made to you', async () => {
  await assertSucceeds(getDoc(doc(as('ann'), 'follows/ann_pub')));
  await assertSucceeds(getDoc(doc(as('pub'), 'follows/ann_pub')));
  await assertSucceeds(getDoc(doc(as('ann'), 'follows/ann_nobody')));
  await assertSucceeds(getDocs(query(collection(as('ann'), 'follows'), where('followerUid', '==', 'ann'))));
  await assertSucceeds(getDocs(query(collection(as('pub'), 'follows'), where('followeeUid', '==', 'pub'))));
});
await t('follows: nobody reads someone else\'s follows or lists who follows someone else', async () => {
  await assertFails(getDoc(doc(as('bob'), 'follows/ann_pub')));
  await assertFails(getDocs(query(collection(as('bob'), 'follows'), where('followeeUid', '==', 'pub'))));
  await assertFails(getDocs(query(collection(as('bob'), 'follows'), where('followerUid', '==', 'ann'))));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'follows/ann_pub')));
});
await t('follows: no client creates, changes or deletes a follow (server only)', async () => {
  await assertFails(setDoc(doc(as('cat'), 'follows/cat_pub'), { followerUid: 'cat', followeeUid: 'pub', createdAtMs: 1 }));
  await assertFails(updateDoc(doc(as('ann'), 'follows/ann_pub'), { createdAtMs: 2 }));
  await assertFails(deleteDoc(doc(as('ann'), 'follows/ann_pub')));
  await assertFails(deleteDoc(doc(as('pub'), 'follows/ann_pub')));
});
await t('follow_log: server only', async () => {
  await assertFails(getDoc(doc(as('ann'), 'follow_log/ann')));
  await assertFails(setDoc(doc(as('ann'), 'follow_log/ann'), { at: [] }));
});
await t('follower counts: the owner cannot set or raise them', async () => {
  await assertFails(updateDoc(doc(as('pub'), 'users/pub'), { followerCount: 1000000 }));
  await assertSucceeds(updateDoc(doc(as('pub'), 'users/pub'), { public: true, updatedAt: serverTimestamp() }));
});

console.log('network_metrics (Phase 2+ dashboard)');
await reset();
await seed((db) => setDoc(doc(db, 'network_metrics/2026-10-12'), { date: '2026-10-12', follows_total: 1 }));
await t('network_metrics: only the admin dashboard reads it; nobody writes', async () => {
  await assertSucceeds(getDoc(doc(env.authenticatedContext('admin-dashboard', { dashboardAdmin: true }).firestore(), 'network_metrics/2026-10-12')));
  await assertFails(getDoc(doc(as('ann'), 'network_metrics/2026-10-12')));
  await assertFails(getDoc(doc(env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: true }).firestore(), 'network_metrics/2026-10-12')));
  await assertFails(setDoc(doc(env.authenticatedContext('admin-dashboard', { dashboardAdmin: true }).firestore(), 'network_metrics/x'), { follows_total: 9 }));
});

console.log('mapr_neighbors (Phase 2)');
await reset();
await seed((db) => setDoc(doc(db, 'mapr_neighbors/ann'), { global: [{ uid: 'bob', score: 0.7 }], byRegion: {} }));
await t('mapr_neighbors: only the owner reads or deletes it; nobody writes it', async () => {
  await assertSucceeds(getDoc(doc(as('ann'), 'mapr_neighbors/ann')));
  await assertFails(getDoc(doc(as('bob'), 'mapr_neighbors/ann')));
  await assertFails(getDocs(query(collection(as('bob'), 'mapr_neighbors'))));
  await assertFails(setDoc(doc(as('ann'), 'mapr_neighbors/ann'), { global: [{ uid: 'cat', score: 1 }] }));
  await assertFails(updateDoc(doc(as('ann'), 'mapr_neighbors/ann'), { global: [] }));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'mapr_neighbors/ann')));
  await assertSucceeds(deleteDoc(doc(as('ann'), 'mapr_neighbors/ann')));
});

console.log('community_density (Phase 3)');
await reset();
await seed((db) => setDoc(doc(db, 'community_density/philly'), { ramp: 0.2, activeUsers: 20, gateOpen: false }));
await t('community_density: only the admin dashboard reads it; no app user; nobody writes', async () => {
  await assertSucceeds(getDoc(doc(env.authenticatedContext('admin-dashboard', { dashboardAdmin: true }).firestore(), 'community_density/philly')));
  await assertFails(getDoc(doc(as('ann'), 'community_density/philly')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'community_density/philly')));
  await assertFails(setDoc(doc(as('ann'), 'community_density/philly'), { ramp: 1 }));
  await assertFails(setDoc(doc(env.authenticatedContext('admin-dashboard', { dashboardAdmin: true }).firestore(), 'community_density/philly'), { ramp: 1 }));
});

console.log('reputation (Phase 4)');
await reset();
await seed(async (db) => {
  await setDoc(doc(db, 'reputation/fin'), { levels: { philly: 'Local' }, badges: ['first-find'] });
  await setDoc(doc(db, 'reputation_scores/fin'), { byRegion: { philly: { score: 25, people: 3 } } });
  await setDoc(doc(db, 'influence_events/t_a_went'), { finderUid: 'fin', actorUid: 'a', kind: 'went' });
  await setDoc(doc(db, 'community_founding/philly'), { uids: ['fin'] });
});
await t('reputation: anyone signed in reads levels and badges; nobody writes them, not even the owner', async () => {
  await assertSucceeds(getDoc(doc(as('ann'), 'reputation/fin')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'reputation/fin')));
  await assertFails(setDoc(doc(as('fin'), 'reputation/fin'), { levels: { philly: 'Insider' } }));
  await assertFails(updateDoc(doc(as('fin'), 'reputation/fin'), { badges: ['founding-philly'] }));
});
await t('reputation points, influence events and the founding list: server only, even for the finder', async () => {
  await assertFails(getDoc(doc(as('fin'), 'reputation_scores/fin')));
  await assertFails(getDoc(doc(as('fin'), 'influence_events/t_a_went')));
  await assertFails(getDoc(doc(as('a'), 'influence_events/t_a_went')));
  await assertFails(getDocs(query(collection(as('fin'), 'influence_events'), where('finderUid', '==', 'fin'))));
  await assertFails(getDoc(doc(as('fin'), 'community_founding/philly')));
  await assertFails(setDoc(doc(as('fin'), 'reputation_scores/fin'), { byRegion: {} }));
});

console.log('discovery alerts (Phase 5)');
await reset();
await t('notificationPrefs: the owner saves known switches as true or false; nothing else, nobody else', async () => {
  await assertSucceeds(setDoc(doc(as('ann'), 'users/ann/private/main'), { notificationPrefs: { tipWent: false, nearbyFind: true } }, { merge: true }));
  await assertFails(setDoc(doc(as('ann'), 'users/ann/private/main'), { notificationPrefs: { tipWent: 'no' } }, { merge: true }));
  await assertFails(setDoc(doc(as('ann'), 'users/ann/private/main'), { notificationPrefs: { spamMe: true } }, { merge: true }));
  await assertFails(setDoc(doc(as('bob'), 'users/ann/private/main'), { notificationPrefs: { tipWent: true } }, { merge: true }));
});
await t('alert_log and follow_alerted: server only', async () => {
  await assertFails(getDoc(doc(as('ann'), 'follow_alerted/ann_bob')));
  await assertFails(setDoc(doc(as('ann'), 'follow_alerted/ann_bob'), { at: 1 }));
  await assertFails(getDoc(doc(as('ann'), 'alert_log/ann')));
  await assertFails(setDoc(doc(as('ann'), 'alert_log/ann'), { wentDay: '2026-10-13' }));
});

console.log('feed (Phase 6)');
await reset();
await t("pick marks: a rating or vote on a place seen in the Feed saves (pickSurface 'feed')", async () => {
  await assertSucceeds(setDoc(doc(as('ann'), 'pick_feedback/ann_pm1'), { userId: 'ann', landmarkId: 'pm1', verdict: 'yes', at: Date.now(), pickSetId: 'ann-1-x', pickSurface: 'feed', pickShownAt: Date.now() }));
});
await t("recommendation_log: 'feed' is an allowed surface", async () => {
  await assertSucceeds(setDoc(doc(as('bob'), 'recommendation_log/fd1'), { userId: 'bob', landmarkId: 'lm1', pickType: null, surface: 'feed', setId: 's1', rank: 1, shownAt: 1 }));
  await assertFails(setDoc(doc(as('bob'), 'recommendation_log/fd2'), { userId: 'ann', landmarkId: 'lm1', pickType: null, surface: 'feed' }));
});

await env.cleanup();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
