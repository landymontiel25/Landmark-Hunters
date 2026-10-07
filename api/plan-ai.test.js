import { describe, it, expect } from 'vitest';
import { trimTurns, conciseReply, asksToRateHere, asksToRate } from './plan-ai.js';

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

describe('plan-ai conciseReply', () => {
  const long =
    "Your taste score improves when Mapr guesses right. **Rate places I suggest** to give me data. Answer pick cards honestly. Be specific in comments. The more you rate the better.";

  it('cuts a long answer to two plain sentences', () => {
    expect(conciseReply(long, 'how can i bring up my taste score')).toBe(
      'Your taste score improves when Mapr guesses right. Rate places I suggest to give me data.'
    );
  });

  it('keeps the full answer when they ask for more', () => {
    expect(conciseReply(long, 'explain how my taste score works')).toContain('The more you rate the better.');
    expect(conciseReply(long, 'tell me more')).not.toContain('**');
  });

  it('strips list markers and leaves short replies alone', () => {
    expect(conciseReply('- One thing', 'hi')).toBe('One thing');
    expect(conciseReply('Try Hillstone.', 'dinner?')).toBe('Try Hillstone.');
    expect(conciseReply('', 'x')).toBe('');
  });
});

describe('plan-ai asksToRateHere', () => {
  it('spots a request to rate where they are', () => {
    expect(asksToRateHere('can i rate here')).toBe(true);
    expect(asksToRateHere('Can I rate this place?')).toBe(true);
    expect(asksToRateHere('i want to rate where i am')).toBe(true);
  });
  it('ignores everything else', () => {
    expect(asksToRateHere('where should I eat here')).toBe(false);
    expect(asksToRateHere('rate Hillstone')).toBe(false);
    expect(asksToRateHere('')).toBe(false);
  });
});

describe('plan-ai asksToRate', () => {
  it('spots any ask to rate', () => {
    for (const t of ['can i rate here', 'No, can I rate here?', 'can I rate a landmark', 'let me rate some places', 'I want to rate', 'give me places to rate', 'rate more places'])
      expect(asksToRate(t)).toBe(true);
  });
  it('leaves other talk alone', () => {
    for (const t of ['how do i increase my taste score', 'what should I eat', 'rate Hillstone', 'accurate map'])
      expect(asksToRate(t)).toBe(false);
  });
});
