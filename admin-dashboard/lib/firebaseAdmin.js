// Server only. Loads the service-account key for lib/firestoreServer.ts.
//
// Key source: the FIRESTORE_ADMIN_KEY env var (raw JSON or base64, see
// README). No key is stored in the repo.

// Names accepted for the key, in order. The README says FIRESTORE_ADMIN_KEY;
// the others are the names people reach for.
export const KEY_ENV_NAMES = ['FIRESTORE_ADMIN_KEY', 'FIREBASE_ADMIN_KEY', 'FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_SERVICE_ACCOUNT_KEY', 'GOOGLE_SERVICE_ACCOUNT'];

export function keyFromEnv(env = process.env) {
  for (const name of KEY_ENV_NAMES) if (env[name] && env[name].trim()) return env[name];
  return '';
}

export function parseServiceAccount(raw = keyFromEnv()) {
  if (!raw || !raw.trim()) {
    const seen = Object.keys(process.env).filter((n) => /FIRE|GOOGLE|SERVICE/i.test(n) && !n.startsWith('NEXT_PUBLIC')).join(', ') || 'none';
    throw new Error(`No service-account key found. Set ${KEY_ENV_NAMES[0]} in this Vercel project's environment variables for this deployment's environment (Production vs Preview) and redeploy. Firebase-related variable names this deployment can see: ${seen}.`);
  }
  const text = raw.trim();
  let json;
  try {
    json = JSON.parse(text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf-8'));
  } catch {
    throw new Error('The service-account key variable is set but is not valid JSON (or base64 of JSON). Paste the whole downloaded .json file.');
  }
  if (!json.client_email || !json.private_key) throw new Error('The service-account key variable is missing client_email or private_key. Paste the whole downloaded .json file.');
  return json;
}

// Google publishes the live public keys of every service account. A key
// that was deleted or revoked is absent, and Firebase then rejects every
// token it signs with auth/invalid-custom-token. Returns null when the key
// is live or the check could not run.
export async function deadKeyProblem(account, fetchImpl = fetch) {
  try {
    const r = await fetchImpl('https://www.googleapis.com/robot/v1/metadata/x509/' + encodeURIComponent(account.client_email), { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const certs = await r.json();
    if (account.private_key_id && !(account.private_key_id in certs)) {
      return `The key in the environment variable (id ${String(account.private_key_id).slice(0, 8)}…, ${account.client_email}) is deleted or revoked in Google Cloud. Generate a new key and replace the variable.`;
    }
  } catch { /* offline or timed out: skip the check */ }
  return null;
}
