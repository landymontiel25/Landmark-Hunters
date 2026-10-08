import { describe, it, expect, vi } from 'vitest';

vi.mock('./firebaseAdmin.js', () => ({ adminDb: () => null }));
const { loadServerModels } = await import('./maprServerModels.js');

describe('loadServerModels cache', () => {
  it('does not cache a failed read, so the next request retries', async () => {
    let fail = true;
    const db = {
      collection: (col) => ({
        doc: (id) => ({
          get: async () => {
            if (fail && col === 'mapr_user_models') throw new Error('unavailable');
            return { exists: col === 'mapr_user_models', data: () => ({ stagnating: true, id }) };
          },
        }),
      }),
    };
    const first = await loadServerModels({ uid: 'retry-user', db, now: 1000 });
    expect(first.serverStagnating).toBe(false);
    fail = false;
    const second = await loadServerModels({ uid: 'retry-user', db, now: 2000 });
    expect(second.serverStagnating).toBe(true);
  });
});
