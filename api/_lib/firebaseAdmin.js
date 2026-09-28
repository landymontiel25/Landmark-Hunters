import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
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

export function adminMessaging() {
  return getMessaging(adminApp());
}

export function adminDb() {
  return getFirestore(adminApp());
}
