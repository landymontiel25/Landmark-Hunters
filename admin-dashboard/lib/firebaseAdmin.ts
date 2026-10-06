import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Server only. FIRESTORE_ADMIN_KEY is the service-account JSON, raw or base64.
export function parseServiceAccount(raw = process.env.FIRESTORE_ADMIN_KEY): Record<string, string> {
  if (!raw) throw new Error('FIRESTORE_ADMIN_KEY is not set.');
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const json = JSON.parse(text);
  if (!json.client_email || !json.private_key) throw new Error('FIRESTORE_ADMIN_KEY is not a service-account key.');
  return json;
}

function adminApp(): App {
  return getApps()[0] || initializeApp({ credential: cert(parseServiceAccount() as never) });
}

// The dashboard's own Firebase identity. firestore.rules isDashboard()
// allows reads only for a token carrying this claim, which only the Admin
// SDK can mint.
export const DASHBOARD_UID = 'admin-dashboard';
export const DASHBOARD_CLAIMS = { dashboardAdmin: true };
export async function mintDashboardToken(): Promise<string> {
  return getAuth(adminApp()).createCustomToken(DASHBOARD_UID, DASHBOARD_CLAIMS);
}
