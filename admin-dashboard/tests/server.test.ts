import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { _resetLoginLimits, SESSION_COOKIE, signSession } from '@/lib/auth';
import { forwardJob } from '@/lib/jobs';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { createPublicKey } from 'node:crypto';
import { parseServiceAccount } from '@/lib/firebaseAdmin';

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
    const { POST } = await import('@/app/api/firebase-token/route');
    expect((await POST(req('/api/firebase-token'))).status).toBe(401);
    const res = await POST(req('/api/firebase-token', undefined, await signSession()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.').length).toBe(3);
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

describe('service account key', () => {
  it('parses embedded base64 Firebase service account', () => {
    const account = parseServiceAccount();
    expect(account.client_email).toBeDefined();
    expect(account.private_key).toBeDefined();
    expect(account.project_id).toBe('landmark-hunters-284ab');
  });
});

describe('mintDashboardToken (no firebase-admin)', () => {
  it('signs a Firebase custom token that verifies against the service account public key', async () => {
    const account = parseServiceAccount();
    const { mintDashboardToken } = await vi.importActual<typeof import('@/lib/firebaseAdmin')>('@/lib/firebaseAdmin');
    const token = await mintDashboardToken();
    const pub = await importSPKI(createPublicKey(account.private_key).export({ type: 'spki', format: 'pem' }) as string, 'RS256');
    const { payload } = await jwtVerify(token, pub, { audience: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit', issuer: account.client_email });
    expect(payload.sub).toBe(account.client_email);
    expect(payload.uid).toBe('admin-dashboard');
    expect(payload.claims).toEqual({ dashboardAdmin: true });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(3600);
    expect(decodeProtectedHeader(token).alg).toBe('RS256');
  });
  it('prefers FIRESTORE_ADMIN_KEY (raw JSON or base64) over the embedded key', () => {
    const fake = JSON.stringify({ client_email: 'x@y.z', private_key: 'k' });
    expect(parseServiceAccount(fake).client_email).toBe('x@y.z');
    expect(parseServiceAccount(Buffer.from(fake).toString('base64')).client_email).toBe('x@y.z');
  });
});
