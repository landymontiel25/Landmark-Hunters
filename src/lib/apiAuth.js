import { auth } from './firebase';
import { appCheckHeaders } from './appCheck';

// Headers for our own /api/* endpoints: the current user's Firebase ID token
// and, when App Check is on, its token (src/lib/appCheck.js). The AI
// endpoints require a signed-in account (api/_lib/aiGuard.js); the Google
// ones count usage per account when signed in and per IP when not
// (api/_lib/billedGuard.js). Signed out, only the App Check header is sent.
export async function authHeaders() {
  const check = await appCheckHeaders();
  const user = auth?.currentUser;
  if (!user) return check;
  try {
    return { ...check, Authorization: `Bearer ${await user.getIdToken()}` };
  } catch {
    return check;
  }
}
