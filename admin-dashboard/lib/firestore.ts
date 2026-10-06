'use client';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

// The browser's Firebase, for live Firestore listeners. It signs in with the
// custom token from /api/firebase-token (the dashboardAdmin identity), the
// only one firestore.rules lets read the stats. Set
// NEXT_PUBLIC_USE_FIRESTORE_EMULATOR=1 to point at a local emulator.

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

export function firebaseConfig(raw = process.env.NEXT_PUBLIC_FIREBASE_CONFIG): Record<string, string> | null {
  if (!raw) return null;
  try {
    const cfg = JSON.parse(raw);
    return cfg && cfg.apiKey && cfg.projectId ? cfg : null;
  } catch {
    return null;
  }
}

export function clientFirebase(): { db: Firestore; auth: Auth } | null {
  if (db && auth) return { db, auth };
  const cfg = firebaseConfig();
  if (!cfg) return null;
  app = getApps()[0] || initializeApp(cfg);
  db = getFirestore(app);
  auth = getAuth(app);
  if (process.env.NEXT_PUBLIC_USE_FIRESTORE_EMULATOR === '1') {
    try {
      connectFirestoreEmulator(db, 'localhost', 8080);
    } catch {
      /* already connected */
    }
  }
  return { db, auth };
}

// Signs in as the dashboard (once; Firebase keeps the session fresh after).
export async function ensureDashboardSignIn(fetchImpl: typeof fetch = fetch): Promise<void> {
  const fb = clientFirebase();
  if (!fb) throw new Error('NEXT_PUBLIC_FIREBASE_CONFIG is missing or not valid JSON.');
  await fb.auth.authStateReady();
  const user = fb.auth.currentUser;
  if (user) {
    const claims = (await user.getIdTokenResult()).claims;
    if (claims.dashboardAdmin === true) return;
  }
  const r = await fetchImpl('/api/firebase-token', { method: 'POST' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.token) throw new Error(body.error || `Firebase sign-in failed (${r.status}).`);
  await signInWithCustomToken(fb.auth, body.token);
}

export async function dashboardSignOut(): Promise<void> {
  const fb = clientFirebase();
  if (fb) await signOut(fb.auth).catch(() => {});
}
