import { describe, it, expect, vi } from 'vitest';

let reviews = {};
const fakeDb = {
  collection: () => ({
    where: (_f, _op, uid) => ({
      get: async () => ({ docs: (reviews[uid] || []).map((r) => ({ data: () => r })) }),
    }),
  }),
};
vi.mock('./firebaseAdmin.js', () => ({ adminDb: () => fakeDb }));

const { computeCompatibilityServer } = await import('./compatibility.js');

const rate = (landmarkId, extra = {}) => ({ landmarkId, ratingTier: 'highly-recommend', hidden: false, ...extra });
const ids = Array.from({ length: 9 }, (_, i) => `lm-${i}`);

describe('computeCompatibilityServer', () => {
  it('matches a review saved under a renamed SF id, like the client copy', async () => {
    reviews = {
      a: [...ids.map((id) => rate(id)), rate('the-battery', { region: 'san-francisco' })],
      b: [...ids.map((id) => rate(id)), rate('the-battery-sf', { region: 'san-francisco' })],
    };
    const r = await computeCompatibilityServer('a', 'b');
    expect(r).toEqual({ sharedCount: 10, score: 1 });
  });

  it("skips the partner's hidden reviews, which the client can't read", async () => {
    reviews = {
      a: [...ids.map((id) => rate(id)), rate('lm-x')],
      b: [...ids.map((id) => rate(id)), rate('lm-x', { hidden: true })],
    };
    const r = await computeCompatibilityServer('a', 'b');
    expect(r).toEqual({ sharedCount: 9, score: null });
  });
});
