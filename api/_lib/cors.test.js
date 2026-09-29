import { describe, it, expect, vi } from 'vitest';
import { withCors } from './cors.js';

function mockRes() {
  const headers = {};
  const res = {
    headers,
    setHeader: (k, v) => { headers[k] = v; },
    status: vi.fn(() => res),
    end: vi.fn(),
    json: vi.fn(),
  };
  return res;
}

describe('withCors', () => {
  it('answers an allowed origin\'s preflight with 204 and never runs the handler', async () => {
    const handler = vi.fn();
    const res = mockRes();
    await withCors(handler)({ method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }, res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('capacitor://localhost');
    expect(res.headers['Access-Control-Allow-Headers']).toMatch(/Authorization/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows https://localhost and passes real requests through with the CORS header set', async () => {
    const handler = vi.fn();
    const res = mockRes();
    await withCors(handler)({ method: 'POST', headers: { origin: 'https://localhost' } }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://localhost');
    expect(handler).toHaveBeenCalled();
  });

  it('sets no CORS headers for other origins', async () => {
    const res = mockRes();
    await withCors(vi.fn())({ method: 'POST', headers: { origin: 'https://evil.example' } }, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
