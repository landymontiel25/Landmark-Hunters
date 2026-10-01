import { initializeApp, getApps } from 'firebase/app';
import { Capacitor } from '@capacitor/core';
import { getAuth, initializeAuth, indexedDBLocalPersistence, connectAuthEmulator } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

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
// Firestore's default web cache is in-memory only: a write queued in a tunnel
// is lost if the tab/app is closed before signal returns, and a cold start
// offline has no cached data at all. A persistent (IndexedDB) cache keeps
// queued writes and last-seen documents across restarts; the multi-tab
// manager lets several tabs share it. Falls back to the default where
// IndexedDB is unavailable (private windows, some web views) or Firestore was
// already initialized (hot reload).
function createDb() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}
export const db = firebaseEnabled ? createDb() : null;

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

// Local rules testing only: VITE_USE_EMULATOR=1 points the SDKs at the Firebase
// emulators (auth 9099, firestore 8080, storage 9199). Never set in production.
if (firebaseEnabled && import.meta.env.VITE_USE_EMULATOR) {
  try {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    if (_storage) connectStorageEmulator(_storage, '127.0.0.1', 9199);
  } catch { /* already connected (hot reload) */ }
}
