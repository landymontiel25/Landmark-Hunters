import { describe, it, expect } from 'vitest';
import { trimTurns } from './plan-ai.js';

describe('plan-ai trimTurns', () => {
  it('never starts with an assistant turn once a chat is long (the API rejects that)', () => {
    const chat = Array.from({ length: 13 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` }));
    const turns = trimTurns(chat);
    expect(turns[0].role).toBe('user');
    expect(turns[turns.length - 1].role).toBe('user');
    expect(turns.length).toBeLessThanOrEqual(10);
  });

  it('keeps short chats intact and drops junk entries', () => {
    expect(trimTurns([{ role: 'user', content: ' hi ' }, null, { role: 'system', content: 'x' }, { role: 'user', content: '  ' }])).toEqual([
      { role: 'user', content: 'hi' },
    ]);
    expect(trimTurns(undefined)).toEqual([]);
  });
});
