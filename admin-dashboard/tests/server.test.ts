import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { _resetLoginLimits, SESSION_COOKIE, signSession } from '@/lib/auth';
import { forwardJob } from '@/lib/jobs';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { deadKeyProblem, keyFromEnv, parseServiceAccount } from '@/lib/firebaseAdmin';

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
});

describe('POST /api/firebase-token', () => {
  it('needs a session, then returns a JWT token', async () => {
    process.env.FIRESTORE_ADMIN_KEY = JSON.stringify(TEST_ACCOUNT);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ kid1: 'cert' }), { status: 200 }));
    const { POST } = await import('@/app/api/firebase-token/route');
    expect((await POST(req('/api/firebase-token'))).status).toBe(401);
    const res = await POST(req('/api/firebase-token', undefined, await signSession()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.').length).toBe(3);
    vi.unstubAllGlobals();
  });
  it('answers 503 and names the missing env var when no key is configured', async () => {
    delete process.env.FIRESTORE_ADMIN_KEY;
    const { POST } = await import('@/app/api/firebase-token/route');
    const res = await POST(req('/api/firebase-token', undefined, await signSession()));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('No service-account key found');
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
    expect((await forwardJob('backfill', { appUrl: '', secret: '', fetchImpl: fetchImpl as never })).status).toBe(503);
    expect((await forwardJob('backfill', { appUrl: 'x', secret: 's', fetchImpl: (async () => { throw new Error('down'); }) as never })).status).toBe(502);
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

describe('mintDashboardToken (no firebase-admin)', () => {
  it('signs a Firebase custom token that verifies against the key\'s public half', async () => {
    const { mintDashboardToken } = await vi.importActual<typeof import('@/lib/firebaseAdmin')>('@/lib/firebaseAdmin');
    const token = await mintDashboardToken(TEST_ACCOUNT);
    const pub = await importSPKI(createPublicKey(TEST_PEM).export({ type: 'spki', format: 'pem' }) as string, 'RS256');
    const { payload } = await jwtVerify(token, pub, { audience: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit', issuer: TEST_ACCOUNT.client_email });
    expect(payload.sub).toBe(TEST_ACCOUNT.client_email);
    expect(payload.uid).toBe('admin-dashboard');
    expect(payload.claims).toEqual({ dashboardAdmin: true });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(3600);
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: 'RS256', kid: 'kid1' });
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
