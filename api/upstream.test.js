import { describe, it, expect } from 'vitest';
import { aiFailure, isTimeoutError } from './_lib/upstream.js';

describe('aiFailure', () => {
  const msgs = { busy: 'busy', failed: 'failed' };
  it('maps rate limits, timeouts and other errors to distinct JSON messages', () => {
    expect(aiFailure({ status: 429 }, msgs)).toEqual({ status: 429, error: 'busy' });
    expect(aiFailure({ name: 'APIConnectionTimeoutError' }, msgs).status).toBe(504);
    expect(aiFailure(Object.assign(new Error('x'), { name: 'TimeoutError' }), msgs).status).toBe(504);
    expect(aiFailure(new Error('boom'), msgs)).toEqual({ status: 500, error: 'failed' });
    expect(isTimeoutError(null)).toBe(false);
  });
});
