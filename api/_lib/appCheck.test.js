import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { appCheckGate, appCheckMode, verifyAppCheckToken, resetAppCheckCacheForTests } from './appCheck.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ keys: [jwk] }) }));
const env = { FIREBASE_PROJECT_NUMBER: '123' };
const NOW = 1_800_000_000_000;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims = {}, header = {}) {
  const h = b64({ alg: 'RS256', typ: 'JWT', kid: 'k1', ...header });
  const p = b64({ iss: 'https://firebaseappcheck.googleapis.com/123', aud: ['projects/123', 'projects/lh'], exp: NOW / 1000 + 3600, sub: 'app', ...claims });
  const sig = createSign('RSA-SHA256').update(`${h}.${p}`).sign(privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}
function fakeRes() {
  return { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

beforeEach(() => resetAppCheckCacheForTests());
afterEach(() => vi.restoreAllMocks());

describe('App Check', () => {
  it('accepts a token signed by the published key for this project', async () => {
    expect(await verifyAppCheckToken(token(), { env, fetchImpl, now: NOW })).toMatchObject({ sub: 'app' });
  });

  it('rejects other projects, expired tokens, unknown keys and tampering', async () => {
    const opts = { env, fetchImpl, now: NOW };
    expect(await verifyAppCheckToken(token({ aud: ['projects/999'] }), opts)).toBeNull();
    expect(await verifyAppCheckToken(token({ iss: 'https://evil' }), opts)).toBeNull();
    expect(await verifyAppCheckToken(token({ exp: NOW / 1000 - 1 }), opts)).toBeNull();
    expect(await verifyAppCheckToken(token({}, { kid: 'nope' }), opts)).toBeNull();
    expect(await verifyAppCheckToken(token({}, { alg: 'none' }), opts)).toBeNull();
    const [h, , s] = token().split('.');
    expect(await verifyAppCheckToken(`${h}.${b64({ aud: ['projects/123'] })}.${s}`, opts)).toBeNull();
    expect(await verifyAppCheckToken('', opts)).toBeNull();
  });

  it('defaults to off and only blocks in enforce mode', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(appCheckMode({})).toBe('off');
    expect(appCheckMode({ APP_CHECK_MODE: 'bogus' })).toBe('off');
    const req = { headers: {} };
    expect(await appCheckGate(req, fakeRes(), 'k', { env: { ...env, APP_CHECK_MODE: 'monitor' }, fetchImpl })).toBe(true);
    const res = fakeRes();
    expect(await appCheckGate(req, res, 'k', { env: { ...env, APP_CHECK_MODE: 'enforce' }, fetchImpl })).toBe(false);
    expect(res.code).toBe(401);
    const good = { headers: { 'x-firebase-appcheck': token({ exp: Date.now() / 1000 + 3600 }) } };
    expect(await appCheckGate(good, fakeRes(), 'k', { env: { ...env, APP_CHECK_MODE: 'enforce' }, fetchImpl })).toBe(true);
  });
});
