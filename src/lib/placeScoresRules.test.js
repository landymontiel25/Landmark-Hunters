import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planLearning } from './maprLearning.js';

// The rule for users/{uid}/place_scores lists every field it accepts. A key
// the ledger writes that isn't on it makes Firestore refuse the whole rating
// (what happened after "Would you come back?" shipped, 2026-11-22). This runs
// without the emulator, so it catches that in `npm test`.
const rules = readFileSync('firestore.rules', 'utf8');
const block = rules.slice(rules.indexOf('match /users/{uid}/place_scores/{landmarkId}'));
const list = block.slice(block.indexOf('hasOnly(['), block.indexOf('])', block.indexOf('hasOnly([')));
const allowed = new Set([...list.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]));

const landmark = { id: 'abaco-beach-resort', region: 'abacos', categories: ['food'] };
const answers = [
  { tier: 'highly-recommend', frequency: null, wouldReturn: 'yes' },
  { tier: 'worth-trying', frequency: 'a-lot', wouldReturn: null },
  { tier: 'probably-skip', frequency: null, wouldReturn: 'never-again' },
];

describe('place_scores ledger vs firestore.rules', () => {
  it('finds the rule', () => {
    expect(allowed.has('placeScore')).toBe(true);
  });
  for (const rating of answers) {
    it(`writes only allowed fields (${rating.tier}, ${rating.wouldReturn})`, () => {
      const { ledger } = planLearning({ landmark, next: { rating, comment: 'Lovely marina, slow service' }, nowMs: 1 });
      const extra = Object.keys({ ...ledger, updatedAt: 0 }).filter((k) => !allowed.has(k));
      expect(extra).toEqual([]);
    });
  }
});
