import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { _resetLoginLimits, SESSION_COOKIE, signSession } from '@/lib/auth';
import { forwardJob } from '@/lib/jobs';
import { importSPKI, jwtVerify } from 'jose';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { deadKeyProblem, keyFromEnv, parseServiceAccount } from '@/lib/firebaseAdmin';
import { _resetTokenCache, accessToken, decodeValue, readDoc, readLatest, saveReview } from '@/lib/firestoreServer';

const PASSWORD = 'p'.repeat(32);
beforeEach(() => {
  process.env.ADMIN_SECRET_TOKEN = PASSWORD;
  process.env.JWT_SECRET = 'j'.repeat(40);
  _resetLoginLimits();
});
const req = (path: string, body?: unknown, cookie?: string, ip = '9.9.9.9') =>
  new NextRequest(`http://localhost${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) } });

describe('POST /api/auth/login', () => {
  it('sets an httpOnly, strict session cookie for the right password', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    const res = await POST(req('/api/auth/login', { token: PASSWORD }));
    expect(res.status).toBe(200);
    const set = res.headers.get('set-cookie') || '';
    expect(set).toContain(`${SESSION_COOKIE}=`);
    expect(set.toLowerCase()).toContain('httponly');
    expect(set.toLowerCase()).toContain('samesite=strict');
  });
  it('401 for a wrong password, 429 after 5 tries, 503 when unconfigured', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    expect((await POST(req('/api/auth/login', { token: 'nope' }, undefined, '1.1.1.1'))).status).toBe(401);
    for (let i = 0; i < 4; i++) await POST(req('/api/auth/login', { token: 'nope' }, undefined, '1.1.1.1'));
    expect((await POST(req('/api/auth/login', { token: PASSWORD }, undefined, '1.1.1.1'))).status).toBe(429);
    delete process.env.ADMIN_SECRET_TOKEN;
    expect((await POST(req('/api/auth/login', { token: PASSWORD }, undefined, '2.2.2.2'))).status).toBe(503);
  });
  it('503 with a clear message when the password or JWT secret is too short', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    process.env.ADMIN_SECRET_TOKEN = 'short';
    let res = await POST(req('/api/auth/login', { token: 'short' }, undefined, '3.3.3.3'));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/ADMIN_SECRET_TOKEN must be at least 16/);
    process.env.ADMIN_SECRET_TOKEN = PASSWORD;
    process.env.JWT_SECRET = 'j'.repeat(20);
    res = await POST(req('/api/auth/login', { token: PASSWORD }, undefined, '4.4.4.4'));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/JWT_SECRET must be at least 32/);
  });
});

describe('POST /api/firestore-read', () => {
  const post = async (body: unknown, cookie?: string) => {
    const { POST } = await import('@/app/api/firestore-read/route');
    return POST(req('/api/firestore-read', body, cookie));
  };
  it('needs a session', async () => {
    expect((await post({ kind: 'ping' })).status).toBe(401);
  });
  it('rejects unknown collections and bad input before touching Firestore', async () => {
    process.env.FIRESTORE_ADMIN_KEY = JSON.stringify(TEST_ACCOUNT);
    const c = await signSession();
    expect((await post({ kind: 'latest', col: 'users', field: 'date', n: 5 }, c)).status).toBe(400);
    expect((await post({ kind: 'latest', col: 'growth_metrics', field: 'a/b', n: 5 }, c)).status).toBe(400);
    expect((await post({ kind: 'doc', col: 'app_metrics', id: '../x' }, c)).status).toBe(400);
    expect((await post({ kind: 'review', id: 'a', status: 'deleted' }, c)).status).toBe(400);
    expect((await post({ nope: 1 }, c)).status).toBe(400);
  });
  it('answers 503 and says what is missing when no key is configured', async () => {
    delete process.env.FIRESTORE_ADMIN_KEY;
    const res = await post({ kind: 'ping' }, await signSession());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('No service-account key found');
  });
});

describe('Firestore over REST with the service account', () => {
  const doc = (id: string, fields: Record<string, unknown>) => ({ name: `projects/p/databases/(default)/documents/growth_metrics/${id}`, fields });
  const router = (calls: { url: string; init?: RequestInit }[] = []) =>
    (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      if (url.endsWith(':runQuery')) return new Response(JSON.stringify([{ document: doc('2026-10-02', { active_users: { integerValue: '2' } }) }, { document: doc('2026-10-01', { active_users: { integerValue: '1' }, at: { timestampValue: '2026-10-01T00:00:00Z' } }) }]), { status: 200 });
      if (url.includes('/app_metrics/missing')) return new Response('{}', { status: 404 });
      if (init?.method === 'PATCH') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify(doc('latest', { users: { integerValue: '7' } })), { status: 200 });
    }) as never;
  beforeEach(() => _resetTokenCache());

  it('exchanges a signed JWT for an access token (verifiable with the key) and caches it', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = router(calls);
    expect(await accessToken(TEST_ACCOUNT, f)).toBe('tok');
    await accessToken(TEST_ACCOUNT, f);
    expect(calls.filter((c) => c.url.includes('oauth2')).length).toBe(1);
    const form = new URLSearchParams(String((calls[0].init as RequestInit).body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const pub = await importSPKI(createPublicKey(TEST_PEM).export({ type: 'spki', format: 'pem' }) as string, 'RS256');
    const { payload } = await jwtVerify(form.get('assertion')!, pub, { audience: 'https://oauth2.googleapis.com/token', issuer: TEST_ACCOUNT.client_email });
    expect(payload.scope).toBe('https://www.googleapis.com/auth/datastore');
  });
  it('explains a refused key', async () => {
    const f = (async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), { status: 400 })) as never;
    await expect(accessToken(TEST_ACCOUNT, f)).rejects.toThrow(/Google refused the service-account key \(invalid_grant: Invalid JWT Signature/);
  });
  it('reads the latest docs oldest first, decodes types, and handles missing docs', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = router(calls);
    const rows = await readLatest('growth_metrics', 'date', 2, TEST_ACCOUNT, f);
    expect(rows.map((r) => r.id)).toEqual(['2026-10-01', '2026-10-02']);
    expect(rows[0]).toMatchObject({ active_users: 1, at: { _ms: Date.parse('2026-10-01T00:00:00Z') } });
    const q = JSON.parse(String(calls.find((c) => c.url.endsWith(':runQuery'))!.init!.body));
    expect(q.structuredQuery).toMatchObject({ from: [{ collectionId: 'growth_metrics' }], limit: 2, orderBy: [{ field: { fieldPath: 'date' }, direction: 'DESCENDING' }] });
    expect(await readDoc('app_metrics', 'latest', TEST_ACCOUNT, f)).toMatchObject({ id: 'latest', users: 7 });
    expect(await readDoc('app_metrics', 'missing', TEST_ACCOUNT, f)).toBeNull();
  });
  it('decodes nested maps and arrays', () => {
    expect(decodeValue({ mapValue: { fields: { a: { arrayValue: { values: [{ doubleValue: 1.5 }, { nullValue: null }] } } } } })).toEqual({ a: [1.5, null] });
  });
  it('saves a review with only the four allowed fields, on an existing doc', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    await saveReview('abc', 'resolved', 'fixed', TEST_ACCOUNT, router(calls));
    const patch = calls.find((c) => c.init?.method === 'PATCH')!;
    expect(patch.url).toContain('/big_misses/abc?');
    expect(patch.url).toContain('currentDocument.exists=true');
    expect(Object.keys(JSON.parse(String(patch.init!.body)).fields).sort()).toEqual(['resolution', 'reviewed', 'reviewedAt', 'status']);
  });
});

describe('jobs proxy errors', () => {
  it('names the host and what a non-JSON answer said', async () => {
    const f = (async () => new Response('<html><title>Authentication Required</title><body>Log in to Vercel</body></html>', { status: 403 })) as never;
    const out = await forwardJob('mapr-run', { appUrl: 'https://my-app-abc.vercel.app/', secret: 's', fetchImpl: f });
    // 502, not 403/401: the dashboard session is fine, so the page must not
    // treat it as signed out and loop back to /login.
    expect(out.status).toBe(502);
    expect((out.body as { error: string }).error).toMatch(/my-app-abc\.vercel\.app answered 403 .*Authentication Required.*Deployment Protection/);
  });
  it('turns the app refusing the secret (401 JSON) into 502 with its message', async () => {
    const f = (async () => new Response(JSON.stringify({ error: 'Unauthorized.' }), { status: 401 })) as never;
    const out = await forwardJob('refresh', { appUrl: 'https://app.example/', secret: 'wrong', fetchImpl: f });
    expect(out.status).toBe(502);
    expect(out.body).toEqual({ error: 'Unauthorized.' });
  });
});

describe('proxy (route guard)', () => {
  it('redirects pages to /login and answers 401 to APIs without a session', async () => {
    const { proxy } = await import('@/proxy');
    const page = await proxy(new NextRequest('http://localhost/dashboard/growth'));
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toBe('http://localhost/login');
    const api = await proxy(new NextRequest('http://localhost/api/jobs', { method: 'POST' }));
    expect(api.status).toBe(401);
  });
  it('lets a valid session through', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(new NextRequest('http://localhost/dashboard', { headers: { cookie: `${SESSION_COOKIE}=${await signSession()}` } }));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});

describe('jobs proxy', () => {
  it('forwards only known actions, with the secret, server to server', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const out = await forwardJob('mapr-run', { appUrl: 'https://app.example/', secret: 's', fetchImpl: fetchImpl as never });
    expect(out).toEqual({ status: 200, body: { ok: true } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://app.example/api/admin-jobs');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer s');
    expect((await forwardJob('rm -rf', { appUrl: 'x', secret: 's', fetchImpl: fetchImpl as never })).status).toBe(400);
    expect((await forwardJob('refresh', { appUrl: '', secret: '', fetchImpl: fetchImpl as never })).status).toBe(503);
    expect((await forwardJob('refresh', { appUrl: 'x', secret: 's', fetchImpl: (async () => { throw new Error('down'); }) as never })).status).toBe(502);
  });
});

const { privateKey: TEST_PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const TEST_ACCOUNT = { type: 'service_account', project_id: 'landmark-hunters-284ab', private_key_id: 'kid1', private_key: TEST_PEM, client_email: 'svc@landmark-hunters-284ab.iam.gserviceaccount.com' };

describe('service account key', () => {
  it('parses raw JSON or base64 from FIRESTORE_ADMIN_KEY and rejects a missing or bad key', () => {
    const json = JSON.stringify(TEST_ACCOUNT);
    expect(parseServiceAccount(json).project_id).toBe('landmark-hunters-284ab');
    expect(parseServiceAccount(Buffer.from(json).toString('base64')).client_email).toBe(TEST_ACCOUNT.client_email);
    expect(() => parseServiceAccount('')).toThrow(/No service-account key found/);
    expect(() => parseServiceAccount(JSON.stringify({ a: 1 }))).toThrow(/missing client_email or private_key/);
  });
});

describe('key lookup and revoked-key detection', () => {
  it('finds the key under the alternate variable names', () => {
    expect(keyFromEnv({ FIREBASE_ADMIN_KEY: '{"a":1}' })).toBe('{"a":1}');
    expect(keyFromEnv({ FIREBASE_SERVICE_ACCOUNT: 'x' })).toBe('x');
    expect(keyFromEnv({})).toBe('');
  });
  it('flags a key whose id Google no longer publishes, and passes a live one', async () => {
    const live = (async () => new Response(JSON.stringify({ kid1: 'cert' }), { status: 200 })) as never;
    expect(await deadKeyProblem(TEST_ACCOUNT, live)).toBeNull();
    const gone = (async () => new Response(JSON.stringify({ other: 'cert' }), { status: 200 })) as never;
    expect(await deadKeyProblem(TEST_ACCOUNT, gone)).toMatch(/deleted or revoked/);
    expect(await deadKeyProblem(TEST_ACCOUNT, (async () => { throw new Error('offline'); }) as never)).toBeNull();
  });
});
