import { describe, it, expect } from 'vitest';
import { ALL_LANDMARKS } from '../data/regions';
import { voteWeight, rebuildGlobalTaste, VOTE_DELTAS } from './tagScores';
import { AWAY_VOTE_WEIGHT } from './maprConstants';

const l = ALL_LANDMARKS.find((x) => Number.isFinite(x.lat) && x.categories?.length);

describe('voteWeight', () => {
  it('is full near the place and reduced far from it', () => {
    expect(voteWeight({ lat: l.lat, lng: l.lng }, l.regionId, l.id)).toBe(1);
    expect(voteWeight({ lat: l.lat + 10, lng: l.lng }, l.regionId, l.id)).toBe(AWAY_VOTE_WEIGHT);
  });
  it('is full when the position or the place is unknown', () => {
    expect(voteWeight(null, l.regionId, l.id)).toBe(1);
    expect(voteWeight({ lat: 0, lng: 0 }, 'nowhere', 'nope')).toBe(1);
  });
  it('the overall-taste rebuild weighs far votes the same way', () => {
    const vote = { landmarkId: l.id, region: l.regionId, categories: [l.categories[0]], verdict: 'yes', at: 1 };
    const near = rebuildGlobalTaste({ votes: [{ ...vote, near: { lat: l.lat, lng: l.lng } }], nowMs: 1 });
    const far = rebuildGlobalTaste({ votes: [{ ...vote, near: { lat: l.lat + 10, lng: l.lng } }], nowMs: 1 });
    expect(near.scores[l.categories[0]]).toBe(VOTE_DELTAS.yes);
    expect(far.scores[l.categories[0]]).toBe(VOTE_DELTAS.yes * AWAY_VOTE_WEIGHT);
  });
});
