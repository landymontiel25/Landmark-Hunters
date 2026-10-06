import { importPKCS8, SignJWT } from 'jose';
import { parseServiceAccount, type ServiceAccount } from './firebaseAdmin';

// Server only. Reads the dashboard's Firestore collections with the service
// account's own OAuth token, over Google's REST API. No browser API key, no
// referrer rules and no Firebase sign-in are involved, so nothing in the
// Google Cloud key settings can block it.

const SCOPE = 'https://www.googleapis.com/auth/datastore';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const READABLE = ['mapr_metrics', 'growth_metrics', 'engagement_metrics', 'retention_cohorts', 'accuracy_by_category', 'accuracy_by_city', 'taste_score', 'mapr_ncf_model', 'mapr_similarity_matrix', 'app_metrics', 'big_misses'];
export const MISS_STATUSES = ['pending', 'resolved', 'duplicate'];

type Fetch = typeof fetch;
let cached: { token: string; exp: number; email: string } | null = null;
export const _resetTokenCache = () => {
  cached = null;
};

async function timed(fetchImpl: Fetch, url: string, init?: RequestInit) {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(8000) });
}

export async function accessToken(account: ServiceAccount = parseServiceAccount(), fetchImpl: Fetch = fetch): Promise<string> {
  if (cached && cached.email === account.client_email && cached.exp - 60_000 > Date.now()) return cached.token;
  const key = await importPKCS8(account.private_key.replace(/\\n/g, '\n'), 'RS256');
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', ...(account.private_key_id ? { kid: account.private_key_id } : {}) })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
  const r = await timed(fetchImpl, TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const body = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !body.access_token) {
    throw new Error(`Google refused the service-account key (${body.error || r.status}${body.error_description ? `: ${body.error_description}` : ''}). Generate a new key in Firebase Console > Project settings > Service accounts and replace FIRESTORE_ADMIN_KEY.`);
  }
  cached = { token: body.access_token, exp: Date.now() + (body.expires_in || 3600) * 1000, email: account.client_email };
  return body.access_token;
}

type FsValue = Record<string, unknown>;
// Firestore REST typed value -> plain JSON. Timestamps become { _ms }.
export function decodeValue(v: FsValue): unknown {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return { _ms: Date.parse(String(v.timestampValue)) };
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('arrayValue' in v) return (((v.arrayValue as { values?: FsValue[] }).values) || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(((v.mapValue as { fields?: Record<string, FsValue> }).fields) || {});
  return null;
}
export function decodeFields(fields: Record<string, FsValue> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}
const decodeDoc = (d: { name: string; fields?: Record<string, FsValue> }) => ({ id: d.name.split('/').pop() as string, ...decodeFields(d.fields) });

const base = (account: ServiceAccount) => `https://firestore.googleapis.com/v1/projects/${account.project_id}/databases/(default)/documents`;

async function api(account: ServiceAccount, fetchImpl: Fetch, url: string, init: RequestInit = {}) {
  const token = await accessToken(account, fetchImpl);
  const r = await timed(fetchImpl, url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  const body = await r.json().catch(() => ({}));
  if (r.status === 404) return { missing: true as const, body };
  if (!r.ok) throw new Error(`Firestore answered ${r.status}: ${(body as { error?: { message?: string } })?.error?.message || 'request failed'}`);
  return { missing: false as const, body };
}

// The newest `n` docs of a collection by `field`, oldest first (as the
// dashboard's charts expect).
export async function readLatest(col: string, field: string, n: number, account = parseServiceAccount(), fetchImpl: Fetch = fetch) {
  const { body } = await api(account, fetchImpl, `${base(account)}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }], orderBy: [{ field: { fieldPath: field }, direction: 'DESCENDING' }], limit: n } }),
  });
  const rows = (Array.isArray(body) ? body : []) as { document?: { name: string; fields?: Record<string, FsValue> } }[];
  return rows.filter((r) => r.document).map((r) => decodeDoc(r.document!)).reverse();
}

export async function readDoc(col: string, id: string, account = parseServiceAccount(), fetchImpl: Fetch = fetch) {
  const res = await api(account, fetchImpl, `${base(account)}/${col}/${encodeURIComponent(id)}`);
  return res.missing ? null : decodeDoc(res.body as { name: string; fields?: Record<string, FsValue> });
}

// The only write the dashboard makes: a big miss's review.
export async function saveReview(id: string, status: string, resolution: string, account = parseServiceAccount(), fetchImpl: Fetch = fetch) {
  const fields = {
    status: { stringValue: status },
    reviewed: { booleanValue: status !== 'pending' },
    resolution: { stringValue: resolution.slice(0, 2000) },
    reviewedAt: { timestampValue: new Date().toISOString() },
  };
  const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${f}`).join('&');
  const res = await api(account, fetchImpl, `${base(account)}/big_misses/${encodeURIComponent(id)}?${mask}&currentDocument.exists=true`, { method: 'PATCH', body: JSON.stringify({ fields }) });
  return { ok: !res.missing };
}
