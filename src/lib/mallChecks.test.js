import { describe, expect, it } from 'vitest';
import { runMallChecks } from './mallChecks';
import { applyStoreVote } from './malls';
import { TEST_MALL_PLACES } from '../data/testMalls';
import { TAG_CAP } from './tagScores';

describe('mall lab checks', () => {
  for (const c of runMallChecks()) {
    it(c.name, () => expect(c.pass, c.detail).toBe(true));
  }

  it('uses the Mapr step, cap and decay: +4 up, -6 down, never above the cap', () => {
    const coffee = TEST_MALL_PLACES.find((p) => p.id === 'sunrise-coffee');
    const empty = { scores: {}, at: {}, counts: {} };
    expect(applyStoreVote(empty, coffee, 'up', 0).scores.coffee).toBe(4);
    expect(applyStoreVote(empty, coffee, 'down', 0).scores.coffee).toBe(-6);
    let t = empty;
    for (let i = 0; i < 100; i++) t = applyStoreVote(t, coffee, 'up', 0);
    expect(t.scores.coffee).toBe(TAG_CAP);
    // 90 days later half of it is left before the next vote lands.
    const later = applyStoreVote({ scores: { coffee: 40 }, at: { coffee: 1 }, counts: { coffee: 1 } }, coffee, 'up', 1 + 90 * 86400000);
    expect(later.scores.coffee).toBe(24);
  });
});
