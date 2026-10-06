import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Server only. Firebase service account key loaded at build time.
const firebaseKeyJson = require('../firebase-key.json');

export function parseServiceAccount(): Record<string, string> {
  const json = firebaseKeyJson;
  if (!json.client_email || !json.private_key) throw new Error('firebase-key.json is not a service-account key.');
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
