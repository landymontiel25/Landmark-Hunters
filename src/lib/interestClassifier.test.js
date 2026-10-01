import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyInterest } from './interestClassifier';

vi.mock('./apiAuth', () => ({ authHeaders: async () => ({}) }));
vi.mock('./apiBase', () => ({ API_BASE: '' }));

afterEach(() => vi.unstubAllGlobals());

describe('classifyInterest', () => {
  it('flags a failed request so callers do not save "no matches" for good', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect((await classifyInterest('racing')).failed).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect((await classifyInterest('racing')).failed).toBe(true);
  });

  it('returns the matches and emoji on success, without the failed flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: ['miami/x'], emoji: '\u{1F3CE}' }) })
    );
    const out = await classifyInterest('racing');
    expect(out.failed).toBeUndefined();
    expect(out.matches).toEqual(['miami/x']);
  });
});
