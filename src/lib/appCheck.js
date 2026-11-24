import { getToken } from 'firebase/app-check';
import { appCheckInstance } from './firebase';

// Firebase App Check token for our /api/* calls: the same App Check that
// firebase.js starts at launch for Firestore and Storage (reCAPTCHA
// Enterprise on the web). The iOS app has none yet (it needs App Attest
// through a native plugin), so its calls go without one.

/** { 'X-Firebase-AppCheck': token } when App Check is on and a token comes back, else {}. */
export async function appCheckHeaders() {
  if (!appCheckInstance) return {};
  try {
    const { token } = await getToken(appCheckInstance);
    return token ? { 'X-Firebase-AppCheck': token } : {};
  } catch {
    return {};
  }
}
