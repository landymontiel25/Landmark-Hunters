import { importPKCS8, SignJWT } from 'jose';

// Server only. A Firebase custom token is an RS256 JWT signed with the
// service-account private key, so we sign it here with jose instead of the
// firebase-admin SDK (which Vercel's bundler cannot load). No network call.
//
// Key source: the FIRESTORE_ADMIN_KEY env var (raw JSON or base64, see
// README). No key is stored in the repo.

const AUDIENCE = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

export function parseServiceAccount(raw = process.env.FIRESTORE_ADMIN_KEY) {
  if (!raw || !raw.trim()) throw new Error('FIRESTORE_ADMIN_KEY is not set on this deployment. Create a service-account key in Firebase Console > Project settings > Service accounts and set it in Vercel (README step 3).');
  const text = raw.trim();
  const json = JSON.parse(text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf-8'));
  if (!json.client_email || !json.private_key) throw new Error('Firebase key is not a service-account key.');
  return json;
}

// The dashboard's own Firebase identity. firestore.rules isDashboard()
// allows reads only for a token carrying this claim, which only the
// service-account key can mint.
export const DASHBOARD_UID = 'admin-dashboard';
export const DASHBOARD_CLAIMS = { dashboardAdmin: true };

export async function mintDashboardToken(account = parseServiceAccount()) {
  const key = await importPKCS8(account.private_key.replace(/\\n/g, '\n'), 'RS256');
  return new SignJWT({ uid: DASHBOARD_UID, claims: DASHBOARD_CLAIMS })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', ...(account.private_key_id ? { kid: account.private_key_id } : {}) })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}
