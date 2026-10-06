import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// Server only. Reads firebase-key.json from the admin-dashboard root at runtime.
export function parseServiceAccount(): Record<string, string> {
  try {
    const __dirname = join(fileURLToPath(import.meta.url), '..');
    const keyPath = join(__dirname, '..', 'firebase-key.json');
    const raw = readFileSync(keyPath, 'utf-8');
    const json = JSON.parse(raw);
    if (!json.client_email || !json.private_key) throw new Error('firebase-key.json is not a service-account key.');
    return json;
  } catch (e) {
    throw new Error(`Failed to load firebase-key.json: ${e instanceof Error ? e.message : String(e)}`);
  }
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
