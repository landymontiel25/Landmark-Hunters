import { FieldValue, FieldPath } from 'firebase-admin/firestore';
import { deleteMyFollows } from './follows.js';
import { deleteMine as deleteMyTips } from '../post-tip.js';

// Everything an account owns, removed on the server when the account is
// deleted (owner, 2026-11-23, App Store rule 5.1.1(v)). The app's own wipe
// (src/lib/accountDeletion.js) can't do all of it: Mapr chats are permanent
// to every client (firestore.rules refuses a delete), and many docs are
// server-only. Two callers:
//   api/account.js         the app, during Delete Account, signed in
//   sweepDeletedAccounts   the nightly job, for accounts deleted any other
//                          way (the Firebase console)
//
// Kept on purpose: check-ins, scrubbed of name, photos and location (they
// hold leaderboard history for everyone else), referral_phones and
// photo_hashes (anti-fraud, hashes only), and chats other people own.

const CHUNK = 400;
const BY_ID = ['mapr_neighbors', 'mapr_user_models', 'admin_settings', 'alert_log', 'checkin_payouts', 'follow_log', 'notify_gates', 'onboarding_payouts', 'presence_state', 'referral_stats', 'reputation', 'reputation_scores', 'tip_post_log', 'referrals', 'entitlements'];
const BY_FIELD = [
  ['leaderboard_entries', 'userId'],
  ['pick_feedback', 'userId'],
  ['planning_events', 'userId'],
  ['recommendation_log', 'userId'],
  ['mission_answers', 'userId'],
  ['mission_photos', 'userId'],
  ['photo_bonuses', 'userId'],
  ['landmark_bonuses', 'userId'],
  ['bug_reports', 'userId'],
  ['feature_requests', 'userId'],
  ['notifications', 'uid'],
  ['save_errors', 'uid'],
  ['friend_requests', 'from'],
  ['friend_requests', 'to'],
  ['friend_edges', 'owner'],
  ['friend_edges', 'friend'],
  ['blocks', 'blockerUid'],
  ['blocks', 'blockedUid'],
  ['community_photos', 'photoUid'],
];
// Ids that start with "{uid}_".
const BY_ID_PREFIX = ['photo_bonus_days', 'follow_alerted', 'offline_checkins', 'offline_checkin_days'];
// Storage folders whose files are named {uid}.jpg or {uid}_{n}.jpg.
const PHOTO_FOLDERS = ['checkin_photos', 'review_photos', 'landmark_photos'];

async function deleteRefs(db, refs) {
  for (let i = 0; i < refs.length; i += CHUNK) {
    const batch = db.batch();
    refs.slice(i, i + CHUNK).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  return refs.length;
}

const docsWhere = async (db, col, field, op, value) => (await db.collection(col).where(field, op, value).get()).docs;

/** Removes everything `uid` owns. Returns counts per step and any errors. */
export async function wipeAccountData(db, uid, { bucket = null, tips = deleteMyTips, follows = deleteMyFollows } = {}) {
  if (!uid || typeof uid !== 'string') throw new Error('uid required');
  const out = { removed: {}, errors: [] };
  const step = async (name, fn) => {
    try {
      out.removed[name] = await fn();
    } catch (e) {
      out.errors.push(`${name}: ${e?.message || e}`);
    }
  };

  await step('tips', async () => {
    const [status, body] = await tips(db, { uid });
    if (status !== 200) throw new Error(body?.error || `tips ${status}`);
    return body.tips || 0;
  });
  await step('follows', () => follows(db, uid).then(() => 1));

  // Mapr: your chats go (permanent to clients, not to the server). Projects
  // you own go, and other people's chats in them go back to their owners.
  // Projects you joined drop you, and so do their chats.
  await step('mapr_chats', async () => deleteRefs(db, (await docsWhere(db, 'mapr_chats', 'ownerUid', '==', uid)).map((d) => d.ref)));
  await step('mapr_projects', async () => {
    let n = 0;
    for (const p of await docsWhere(db, 'mapr_projects', 'memberUids', 'array-contains', uid)) {
      const project = p.data();
      const chats = (await docsWhere(db, 'mapr_chats', 'projectId', '==', p.id)).filter((c) => c.data().ownerUid !== uid);
      const batch = db.batch();
      if (project.ownerUid === uid) {
        chats.forEach((c) => batch.update(c.ref, { projectId: null, memberUids: [c.data().ownerUid] }));
        batch.delete(p.ref);
      } else {
        const memberUids = (project.memberUids || []).filter((m) => m !== uid);
        batch.update(p.ref, { memberUids, [`memberNames.${uid}`]: FieldValue.delete() });
        chats.forEach((c) => batch.update(c.ref, { memberUids, archivedUids: FieldValue.arrayRemove(uid) }));
      }
      await batch.commit();
      n++;
    }
    return n;
  });

  // Reviews, their replies and photos.
  const photoUrls = [];
  await step('reviews', async () => {
    const reviews = await docsWhere(db, 'reviews', 'userId', '==', uid);
    for (const d of reviews) {
      const { photoURLs, photoURL } = d.data();
      photoUrls.push(...(photoURLs?.length ? photoURLs : photoURL ? [photoURL] : []));
      await db.recursiveDelete(d.ref);
    }
    return reviews.length;
  });

  // Check-ins: scrubbed, never deleted (see above). The proof doc holds the
  // raw GPS fix, so it goes.
  await step('checkins_scrubbed', async () => {
    const checkins = await docsWhere(db, 'checkins', 'userId', '==', uid);
    for (const d of checkins) {
      const x = d.data();
      photoUrls.push(...(x.photoURL ? [x.photoURL] : []), ...(Array.isArray(x.photoURLs) ? x.photoURLs : []));
      await d.ref.update({
        userName: 'Deleted User',
        photoURL: null,
        photoURLs: [],
        distanceMeters: FieldValue.delete(),
        gpsAccuracyMeters: FieldValue.delete(),
        presence: FieldValue.delete(),
      });
      await deleteRefs(db, (await d.ref.collection('proof').listDocuments()));
    }
    return checkins.length;
  });

  // Streaks you're in: solo ones and dual ones (the pair's streak ends).
  await step('streaks', async () => {
    const streaks = await docsWhere(db, 'streaks', 'memberIds', 'array-contains', uid);
    for (const d of streaks) await db.recursiveDelete(d.ref);
    return streaks.length;
  });
  await step('group_trips', async () => {
    const trips = await docsWhere(db, 'group_trips', 'memberUids', 'array-contains', uid);
    for (const d of trips) {
      if (d.data().ownerUid === uid) await db.recursiveDelete(d.ref);
      else await d.ref.update({ memberUids: FieldValue.arrayRemove(uid), [`memberNames.${uid}`]: FieldValue.delete() });
    }
    return trips.length;
  });
  await step('custom_landmarks', async () => {
    const mine = await docsWhere(db, 'custom_landmarks', 'createdBy', '==', uid);
    for (const d of mine) photoUrls.push(...(Array.isArray(d.data().images) ? d.data().images : []));
    return deleteRefs(db, mine.map((d) => d.ref));
  });

  for (const [col, field] of BY_FIELD) {
    await step(`${col}.${field}`, async () => deleteRefs(db, (await docsWhere(db, col, field, '==', uid)).map((d) => d.ref)));
  }
  for (const col of BY_ID_PREFIX) {
    await step(col, async () => {
      const snap = await db.collection(col).where(FieldPath.documentId(), '>=', `${uid}_`).where(FieldPath.documentId(), '<', `${uid}\``).get();
      return deleteRefs(db, snap.docs.map((d) => d.ref));
    });
  }
  await step('by_id', async () => deleteRefs(db, BY_ID.map((c) => db.collection(c).doc(uid))));

  // The profile last: its username, then users/{uid} with every
  // subcollection (private, favorites, place_scores, open_days, ...).
  await step('users', async () => {
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    const username = snap.exists ? snap.data().username : null;
    if (username) {
      const nameRef = db.collection('usernames').doc(username);
      const nameDoc = await nameRef.get();
      if (nameDoc.exists && nameDoc.data().uid === uid) await nameRef.delete();
    }
    await db.recursiveDelete(userRef);
    return 1;
  });

  // Files: the profile picture, every photo named for this account, and
  // any photo URL the docs above pointed at.
  if (bucket) {
    await step('storage', async () => {
      let n = 0;
      const del = async (file) => {
        try {
          await file.delete();
          n++;
        } catch (e) {
          if (e?.code !== 404) throw e;
        }
      };
      await del(bucket.file(`avatars/${uid}.jpg`));
      for (const folder of PHOTO_FOLDERS) {
        const [files] = await bucket.getFiles({ prefix: `${folder}/`, matchGlob: `${folder}/*/${uid}{.jpg,_*.jpg}` });
        for (const f of files) await del(f);
      }
      for (const url of photoUrls) {
        const path = storagePath(url, bucket.name);
        if (path) await del(bucket.file(path));
      }
      return n;
    });
  }
  return out;
}

// A Firebase download URL (or gs:// path) in this bucket -> its object path.
export function storagePath(url, bucketName) {
  if (typeof url !== 'string') return null;
  const m = url.match(/\/v0\/b\/([^/]+)\/o\/([^?]+)/);
  if (m && m[1] === bucketName) return decodeURIComponent(m[2]);
  const g = url.match(/^gs:\/\/([^/]+)\/(.+)$/);
  return g && g[1] === bucketName ? g[2] : null;
}

// The nightly backstop: accounts deleted without the app (the console)
// still own chats and a profile. Every uid that owns a chat or a users doc
// and has no Auth account any more is wiped, at most `max` a night.
export async function sweepDeletedAccounts(db, auth, { bucket = null, max = 25, wipe = wipeAccountData } = {}) {
  const [chats, users] = await Promise.all([db.collection('mapr_chats').select('ownerUid').get(), db.collection('users').select().get()]);
  const uids = [...new Set([...chats.docs.map((d) => d.data().ownerUid), ...users.docs.map((d) => d.id)].filter((u) => typeof u === 'string' && u))];
  const gone = [];
  for (let i = 0; i < uids.length && gone.length < max; i += 100) {
    const chunk = uids.slice(i, i + 100);
    // A failed lookup skips the chunk: never wipe on a guess.
    const { users: found } = await auth.getUsers(chunk.map((uid) => ({ uid })));
    // A lookup that finds nobody in a full chunk is far more likely broken
    // than a hundred deletions: stop.
    if (chunk.length >= 20 && !found.length) return { checked: uids.length, wiped: 0, aborted: 'lookup found no accounts' };
    const live = new Set(found.map((u) => u.uid));
    gone.push(...chunk.filter((u) => !live.has(u)));
  }
  if (uids.length >= 30 && gone.length > uids.length / 3) return { checked: uids.length, wiped: 0, aborted: 'too many missing accounts' };
  const wiped = [];
  for (const uid of gone.slice(0, max)) {
    const r = await wipe(db, uid, { bucket });
    wiped.push({ errors: r.errors.length });
  }
  return { checked: uids.length, wiped: wiped.length, withErrors: wiped.filter((w) => w.errors).length };
}
