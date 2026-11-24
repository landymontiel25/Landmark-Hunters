import { initializeApp, getApps } from 'firebase/app';
import { Capacitor } from '@capacitor/core';
import { getAuth, initializeAuth, indexedDBLocalPersistence, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, CustomProvider } from 'firebase/app-check';

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

// Firebase App Check (owner, 2026-11-23: enforcement is on for Firestore and
// Storage). Started here, before anything reads Firestore or Storage, so
// every request carries a token; /api/* calls send the same token
// (appCheck.js). reCAPTCHA Enterprise on the web; the site key is public.
// The iOS app can't run reCAPTCHA in its web view: its tokens come from App
// Attest, natively (ios/App/App/AppDelegate.swift), handed over by
// @capacitor-firebase/app-check (owner, 2026-11-24).
export const RECAPTCHA_ENTERPRISE_SITE_KEY = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || '6Lf0hi4uAAAAABVF2iXHjZK-1P8odzpdMLyzQsxR';
// Native tokens last about an hour; this is only a fallback when the plugin
// gives no expiry, so the web SDK asks again soon.
const NATIVE_FALLBACK_TTL_MS = 5 * 60 * 1000;
export const nativeAppCheckProvider = () =>
  new CustomProvider({
    getToken: async () => {
      const { FirebaseAppCheck } = await import('@capacitor-firebase/app-check');
      const { token, expireTimeMillis } = await FirebaseAppCheck.getToken();
      return { token, expireTimeMillis: expireTimeMillis > Date.now() ? expireTimeMillis : Date.now() + NATIVE_FALLBACK_TTL_MS };
    },
  });
function startAppCheck() {
  if (!firebaseEnabled || import.meta.env.VITE_USE_EMULATOR || import.meta.env.MODE === 'test') return null;
  try {
    const provider = Capacitor.isNativePlatform() ? nativeAppCheckProvider() : new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY);
    return initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
  } catch {
    return null;
  }
}
export const appCheckInstance = startAppCheck();
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

// Local rules testing only: VITE_USE_EMULATOR=1 points the SDKs at the Firebase
// emulators (auth 9099, firestore 8080, storage 9199). Never set in production.
if (firebaseEnabled && import.meta.env.VITE_USE_EMULATOR) {
  try {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    if (_storage) connectStorageEmulator(_storage, '127.0.0.1', 9199);
  } catch { /* already connected (hot reload) */ }
}
