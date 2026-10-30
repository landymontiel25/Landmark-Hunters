import { Capacitor } from '@capacitor/core';
import { app, firebaseEnabled } from './firebase';

// Firebase App Check: proves our /api/* calls (and Firestore/Storage reads)
// come from this app, with reCAPTCHA Enterprise as an invisible CAPTCHA on
// the web. Off until VITE_RECAPTCHA_ENTERPRISE_SITE_KEY is set in Vercel.
// The iOS app needs App Attest through a native plugin instead (Google's
// reCAPTCHA won't load in the capacitor:// web view), so it sends no token
// yet; the server stays on APP_CHECK_MODE=monitor until it does
// (docs/rate-limits.md).
const SITE_KEY = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;

let ready = null;
function appCheck() {
  if (!ready) {
    ready =
      firebaseEnabled && SITE_KEY && !Capacitor.isNativePlatform()
        ? import('firebase/app-check')
            .then((m) => ({ m, instance: m.initializeAppCheck(app, { provider: new m.ReCaptchaEnterpriseProvider(SITE_KEY), isTokenAutoRefreshEnabled: true }) }))
            .catch(() => null)
        : Promise.resolve(null);
  }
  return ready;
}

/** { 'X-Firebase-AppCheck': token } when App Check is on and a token comes back, else {}. */
export async function appCheckHeaders() {
  try {
    const ac = await appCheck();
    if (!ac) return {};
    const { token } = await ac.m.getToken(ac.instance);
    return token ? { 'X-Firebase-AppCheck': token } : {};
  } catch {
    return {};
  }
}
