import { initializeApp, getApps } from 'firebase/app';
import { Capacitor } from '@capacitor/core';
import { getAuth, initializeAuth, indexedDBLocalPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

export const app = firebaseEnabled && getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
// getAuth() wires up the popup/redirect resolver, which loads Google's
// iframe-based auth helper. Inside the iOS web view (capacitor://localhost)
// that never finishes loading, so every sign-in call hangs with no error.
// The native app initializes Auth with just IndexedDB persistence and no
// resolver; the web keeps the default.
function createAuth() {
  if (!Capacitor.isNativePlatform()) return getAuth(app);
  try {
    return initializeAuth(app, { persistence: indexedDBLocalPersistence });
  } catch {
    // Already initialized (hot reload) -- reuse that instance.
    return getAuth(app);
  }
}
export const auth = firebaseEnabled ? createAuth() : null;
export const db = firebaseEnabled ? getFirestore(app) : null;

// Storage may not be provisioned (no bucket configured yet). Never let that
// crash the app — photo upload just stays disabled until it's set up.
let _storage = null;
if (firebaseEnabled) {
  try {
    _storage = getStorage(app);
  } catch {
    _storage = null;
  }
}
export const storage = _storage;
