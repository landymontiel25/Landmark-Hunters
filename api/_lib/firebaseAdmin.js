import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// The one place in this app that needs a real Firebase service-account
// secret. Everywhere else (verifyAuth.js) gets by on the public web API key
// plus the Identity Toolkit REST API, but Firebase Cloud Messaging's send
// API has no equivalent public-key path -- sending a push genuinely
// requires privileged server credentials.
//
// Set FIREBASE_SERVICE_ACCOUNT in Vercel to the full JSON of a service
// account key, as one line: Firebase Console -> Project Settings -> Service
// Accounts -> Generate new private key. Until that's set, every function in
// this file throws, and every caller (see push.js) treats that as "push
// isn't configured yet" rather than a hard failure.
function adminApp() {
  if (getApps().length) return getApps()[0];
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!json) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set.');
  return initializeApp({ credential: cert(JSON.parse(json)) });
}

// Messaging loads lazily so Firestore-only routes (the streak routes) never load it.
export async function adminMessaging() {
  const { getMessaging } = await import('firebase-admin/messaging');
  return getMessaging(adminApp());
}

export function adminDb() {
  return getFirestore(adminApp());
}

// Account records (creation time) for the createdAt backfill. firebase-admin's
// own Auth module is not used: it loads jwks-rsa, which require()s an ESM-only
// jose and crashes on Vercel's Node. The Identity Toolkit REST API gives the
// same data with the service account's access token.
export async function adminAuth() {
  const app = adminApp();
  const projectId = app.options.projectId || JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT).project_id;
  return {
    async getUsers(identifiers) {
      const { access_token: token } = await app.options.credential.getAccessToken();
      const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: identifiers.map((x) => x.uid) }),
      });
      if (!r.ok) throw new Error(`Auth lookup failed (${r.status}).`);
      const body = await r.json();
      return {
        users: (body.users || []).map((u) => ({
          uid: u.localId,
          metadata: { creationTime: u.createdAt ? new Date(Number(u.createdAt)).toISOString() : undefined },
        })),
      };
    },
  };
}

// A message a route can hand back instead of crashing when the secret is
// missing (adminApp throws exactly this).
export const SERVICE_ACCOUNT_MISSING = 'FIREBASE_SERVICE_ACCOUNT is not set';
