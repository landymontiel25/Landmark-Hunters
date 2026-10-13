import { describe, it, expect } from 'vitest';
import { countLinks, tipCheckinProblem, tipIdFor, tipInputProblem, tipIsPublic, TIP_MAX_CHARS } from './tips.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const old = { accountAgeMs: 30 * DAY };

describe('tip input', () => {
  it('needs 10 to 280 characters after trimming', () => {
    expect(tipInputProblem({ text: '  short   ' }, old)?.code).toBe('too-short');
    expect(tipInputProblem({ text: 'x'.repeat(TIP_MAX_CHARS + 1) }, old)?.code).toBe('too-long');
    expect(tipInputProblem({ text: 'Go early, the line wraps the block.' }, old)).toBeNull();
    expect(tipInputProblem({ text: 'a'.repeat(280) }, old)).toBeNull();
  });
  it('takes up to 3 known tags, no repeats', () => {
    expect(tipInputProblem({ text: 'Go early, quiet then.', tags: ['go-early', 'quiet', 'views'] }, old)).toBeNull();
    expect(tipInputProblem({ text: 'Go early, quiet then.', tags: ['go-early', 'quiet', 'views', 'free'] }, old)?.code).toBe('bad-tags');
    expect(tipInputProblem({ text: 'Go early, quiet then.', tags: ['best'] }, old)?.code).toBe('bad-tags');
    expect(tipInputProblem({ text: 'Go early, quiet then.', tags: ['quiet', 'quiet'] }, old)?.code).toBe('bad-tags');
    expect(tipInputProblem({ text: 'Go early, quiet then.', tags: 'quiet' }, old)?.code).toBe('bad-tags');
  });
  it('counts http, www and bare-domain links', () => {
    expect(countLinks('see https://a.com/x and www.b.org and c.io/menu')).toBe(3);
    expect(countLinks('No links here. Just a sentence.')).toBe(0);
    expect(countLinks('Great views.Us kids loved it. Ask for Jo.Me and my wife went twice.')).toBe(0);
  });
  it('allows 2 links, never 3, and none in the first week or with an unknown age', () => {
    expect(tipInputProblem({ text: 'Menu at a.com and b.com' }, old)).toBeNull();
    expect(tipInputProblem({ text: 'a.com b.com c.com links' }, old)?.code).toBe('too-many-links');
    expect(tipInputProblem({ text: 'Menu at a.com today' }, { accountAgeMs: 6 * DAY })?.code).toBe('links-new-account');
    expect(tipInputProblem({ text: 'Menu at a.com today' }, { accountAgeMs: null })?.code).toBe('links-new-account');
    expect(tipInputProblem({ text: 'No links, just words.' }, { accountAgeMs: null })).toBeNull();
  });
});

describe('the check-in a tip rests on', () => {
  const c = (o = {}) => ({ userId: 'me', presence: { verified: true }, createdAtMs: NOW - DAY, ...o });
  it('must be yours, a real visit, verified and under 30 days old', () => {
    expect(tipCheckinProblem(c(), 'me', NOW)).toBeNull();
    expect(tipCheckinProblem(null, 'me', NOW)?.code).toBe('no-checkin');
    expect(tipCheckinProblem(c({ userId: 'you' }), 'me', NOW)?.code).toBe('not-yours');
    expect(tipCheckinProblem(c({ ratingOnly: true }), 'me', NOW)?.code).toBe('not-a-visit');
    expect(tipCheckinProblem(c({ presence: { verified: false } }), 'me', NOW)?.code).toBe('not-verified');
    expect(tipCheckinProblem(c({ presence: undefined, verification: 'verified' }), 'me', NOW)?.code).toBe('not-verified');
    expect(tipCheckinProblem(c({ createdAtMs: NOW - 31 * DAY }), 'me', NOW)?.code).toBe('too-old');
    expect(tipCheckinProblem(c({ createdAtMs: null }), 'me', NOW)?.code).toBe('too-old');
  });
});

describe('tip ids and visibility', () => {
  it('one id per person per place', () => expect(tipIdFor('u1', 'bell')).toBe('u1_bell'));
  it('only live, unhidden tips are public', () => {
    expect(tipIsPublic({ status: 'live', hidden: false })).toBe(true);
    expect(tipIsPublic({ status: 'live', hidden: true })).toBe(false);
    expect(tipIsPublic({ status: 'held', hidden: false })).toBe(false);
    expect(tipIsPublic({ status: 'removed' })).toBe(false);
  });
});
