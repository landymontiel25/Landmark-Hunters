// Mapr must look distances up, never make them up: a "how far / how many
// minutes" question forces the route_between tool first, the real route
// goes back to the AI, and only then does it answer.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requests = [];
let replies = [];
const routeCalls = [];
vi.mock('./_lib/aiGuard.js', () => ({ guardAiRequest: async () => true }));
vi.mock('./_lib/aiCallLog.js', () => ({ logAiCall: async () => {} }));
vi.mock('./_lib/cors.js', () => ({ withCors: (h) => h }));
const hoursCalls = [];
vi.mock('./_lib/routeLookup.js', async (orig) => ({
  ...(await orig()),
  placeHours: async (input) => {
    hoursCalls.push(input);
    return { name: 'Kres Chophouse', openNow: true, closesAt: '10:00 PM', today: 'Wednesday: 5:00 PM – 10:00 PM', source: 'Google Maps' };
  },
  routeBetween: async (input) => {
    routeCalls.push(input);
    return { from: { name: 'Kres Chophouse' }, to: { name: 'House of Blues Orlando' }, mode: 'driving', miles: 14.6, km: 23.5, minutes: 23, source: 'Google Maps' };
  },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (req) => {
        requests.push(JSON.parse(JSON.stringify(req)));
        return replies.shift();
      },
    };
  },
}));

const { default: handler } = await import('./plan-ai.js');

async function ask(messages) {
  let json;
  const res = { status() { return this; }, json(j) { json = j; } };
  await handler({ method: 'POST', body: { messages, regionIds: ['miami'] } }, res);
  return json;
}

describe('Mapr distances come from the route lookup', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test';
    requests.length = 0;
    routeCalls.length = 0;
    hoursCalls.length = 0;
  });

  it('forces the lookup for a how-many-minutes question and answers with its numbers', async () => {
    replies = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'route_between', input: { from: 'Kres Chophouse', to: 'House of Blues Orlando' } }], usage: { input_tokens: 1, output_tokens: 1 } },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ reply: 'Kres Chophouse is 14.6 miles from House of Blues Orlando, about 23 minutes by car with current traffic.', stops: [] }) }], usage: { input_tokens: 1, output_tokens: 1 } },
    ];
    const r = await ask([
      { role: 'user', content: 'best steakhouse in orlando' },
      { role: 'assistant', content: 'Try Kres Chophouse.' },
      { role: 'user', content: 'how many minutes away from house of blues' },
    ]);
    expect(requests[0].tool_choice).toEqual({ type: 'tool', name: 'route_between' });
    expect(requests[0].tools.map((t) => t.name)).toContain('route_between');
    expect(routeCalls).toEqual([{ from: 'Kres Chophouse', to: 'House of Blues Orlando' }]);
    const toolResult = requests[1].messages.at(-1).content[0];
    expect(toolResult).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(JSON.parse(toolResult.content)).toMatchObject({ miles: 14.6, minutes: 23 });
    expect(requests[1].tool_choice).toBeUndefined();
    expect(r.reply).toContain('14.6 miles');
  });

  it('does not force the lookup for other questions, and tells the AI never to guess distances', async () => {
    replies = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ reply: 'Try Kres.', stops: [] }) }], usage: {} }];
    await ask([{ role: 'user', content: 'best steakhouse in orlando' }]);
    expect(requests[0].tool_choice).toBeUndefined();
    expect(requests[0].system.map((b) => b.text).join('\n')).toMatch(/never state how far apart two places are/i);
  });

  const say = (reply) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ reply, stops: [] }) }], usage: {} });
  const use = (name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `u-${name}`, name, input }], usage: {} });

  it('sends a guessed distance back once with the lookup required, and shows the real one', async () => {
    replies = [
      say('Kres is about 7 minutes from you.'),
      use('route_between', { from: 'my location', to: 'Kres Chophouse' }),
      say('Kres Chophouse is 14.6 miles away, about 23 minutes by car.'),
    ];
    const r = await ask([{ role: 'user', content: 'best steakhouse in orlando, somewhere i can get to' }]);
    expect(requests[0].tool_choice).toBeUndefined();
    expect(requests[1].tool_choice).toEqual({ type: 'tool', name: 'route_between' });
    expect(r.reply).toBe('Kres Chophouse is 14.6 miles away, about 23 minutes by car.');
  });

  it('never shows a wrong number even when the AI misreports the lookup', async () => {
    replies = [use('route_between', { from: 'Kres Chophouse', to: 'House of Blues Orlando' }), say('It is about 7 miles, roughly 12 minutes.')];
    const r = await ask([{ role: 'user', content: 'how far is kres chophouse from house of blues' }]);
    expect(r.reply).not.toMatch(/\b7 miles|12 minutes/);
    expect(r.reply).toContain('14.6 mi, about 23 min driving with current traffic (Google Maps)');
  });

  it('checks live hours first for "is it open" and keeps only hours the lookup gave', async () => {
    replies = [use('place_hours', { place: 'Kres Chophouse' }), say('Kres Chophouse is open now and closes at 10 PM, and it is $80 a head.')];
    const r = await ask([{ role: 'user', content: 'is kres chophouse open right now' }]);
    expect(requests[0].tool_choice).toEqual({ type: 'tool', name: 'place_hours' });
    expect(hoursCalls).toEqual([{ place: 'Kres Chophouse' }]);
    expect(r.reply).toBe('Kres Chophouse is open now and closes at 10 PM.');
  });
});
