import { describe, it, expect, vi } from 'vitest';

vi.mock('./_lib/aiGuard.js', () => ({ guardAiRequest: async () => true }));
vi.mock('./_lib/verifyAuth.js', () => ({ verifyIdToken: async () => ({ uid: 'u', emailVerified: true }) }));
vi.mock('./_lib/enrichLandmark.js', () => ({ enrichLandmark: vi.fn(), reverseGeocode: async () => '' }));
vi.mock('./_lib/cors.js', () => ({ withCors: (h) => h }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class {} }));

const { default: handler } = await import('./verify-landmark.js');

async function call(body) {
  let status;
  let json;
  const res = {
    status(s) {
      status = s;
      return this;
    },
    json(j) {
      json = j;
    },
  };
  await handler({ method: 'POST', body }, res);
  return { status, json };
}

describe('verify-landmark coordinates', () => {
  it('rejects null/missing coordinates instead of treating them as 0', async () => {
    expect((await call({ name: 'X', lat: null, lng: null })).status).toBe(400);
    expect((await call({ name: 'X', lat: '', lng: '' })).status).toBe(400);
  });
  it('rejects out-of-range coordinates with a clear message', async () => {
    const r = await call({ name: 'X', lat: 123, lng: 10 });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/location/i);
    expect((await call({ name: 'X', lat: 10, lng: 400 })).status).toBe(400);
  });
  it('accepts valid coordinates', async () => {
    expect((await call({ name: 'X', lat: 40, lng: -75 })).status).toBe(200);
  });
});
