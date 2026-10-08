import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  getApps: () => [],
  cert: (j) => j,
  initializeApp: () => ({ options: { projectId: 'p1', credential: { getAccessToken: async () => ({ access_token: 'tok' }) } } }),
}));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));

describe('adminAuth', () => {
  beforeEach(() => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'p1' });
  });

  it('reads account creation times over REST, never loading firebase-admin/auth', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ users: [{ localId: 'u1', createdAt: '1700000000000' }] }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { adminAuth } = await import('./firebaseAdmin.js');
    const out = await (await adminAuth()).getUsers([{ uid: 'u1' }]);
    expect(out.users[0]).toEqual({ uid: 'u1', metadata: { creationTime: new Date(1700000000000).toISOString() } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/projects/p1/accounts:lookup');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ localId: ['u1'] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
