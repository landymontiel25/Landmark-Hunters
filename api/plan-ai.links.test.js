// Every place Mapr names is a link and a card (owner, 2026-11-24): a catalog
// place opens in the app, a searched one links its source, and an ask for a
// landmark always returns the landmark.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requests = [];
let replies = [];
vi.mock('./_lib/aiGuard.js', () => ({ guardAiRequest: async () => ({ uid: 'u1' }) }));
vi.mock('./_lib/aiCallLog.js', () => ({ logAiCall: async () => {} }));
vi.mock('./_lib/cors.js', () => ({ withCors: (h) => h }));
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
const { default: handler, linkPlaceNames, JSON_ONLY } = await import('./plan-ai.js');

async function ask(content, extra = {}) {
  let json;
  const res = { status() { return this; }, json(j) { json = j; } };
  await handler({ method: 'POST', body: { messages: [{ role: 'user', content }], regionIds: ['abacos'], ...extra } }, res);
  return json;
}
const say = (reply, stops = [], searches = 0) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ reply, stops }) }], usage: searches ? { server_tool_use: { web_search_requests: searches } } : {} });

describe('Mapr links and landmark cards', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test';
    requests.length = 0;
  });

  it('a catalog place named only in the words still gets its card, and its name links to it', async () => {
    replies = [say('Start at Elbow Reef Lighthouse, then walk over to Wyannie Malone Historical Museum.')];
    const r = await ask('Plan my morning in Hope Town', { caps: ['placeLinks'] });
    expect(r.stops.map((s) => s.id)).toEqual(['elbow-reef-lighthouse', 'wyannie-malone-historical-museum']);
    expect(r.reply).toBe('Start at {{place:1}}, then walk over to {{place:2}}.');
  });

  it('an older app that never asked for links gets plain names', async () => {
    replies = [say('Start at Elbow Reef Lighthouse.')];
    const r = await ask('Plan my morning in Hope Town');
    expect(r.reply).toBe('Start at Elbow Reef Lighthouse.');
    expect(r.stops[0].id).toBe('elbow-reef-lighthouse');
  });

  it('asking for a landmark returns the landmark, even when the words leave it out', async () => {
    replies = [say("Here it is, it's a great spot.")];
    const r = await ask('Show me the Elbow Reef Lighthouse landmark.', { caps: ['placeLinks'] });
    expect(r.stops.map((s) => s.id)).toEqual(['elbow-reef-lighthouse']);
  });

  it('a searched place links the page it was found on', async () => {
    replies = [
      {
        stop_reason: 'end_turn',
        content: [
          { type: 'server_tool_use', id: 'ws1', name: 'web_search', input: { query: 'pizza Treasure Cay' } },
          { type: 'web_search_tool_result', tool_use_id: 'ws1', content: [{ type: 'web_search_result', url: 'https://example.com/sunset-pizza', title: 'Sunset Pizza, Treasure Cay' }] },
          { type: 'text', text: JSON.stringify({ reply: 'Try Sunset Pizza in Treasure Cay.', stops: [{ name: 'Sunset Pizza', place: 'Treasure Cay', url: 'https://example.com/sunset-pizza', reason: 'Pizza' }] }) },
        ],
        usage: { server_tool_use: { web_search_requests: 1 } },
      },
    ];
    const r = await ask('Pizza in Treasure Cay?', { caps: ['placeLinks'] });
    expect(r.stops[0]).toMatchObject({ external: true, name: 'Sunset Pizza', url: 'https://example.com/sunset-pizza' });
    expect(r.reply).toBe('Try {{place:1}} in Treasure Cay.');
  });

  it('links each name once, longest first, never inside another name or token', () => {
    expect(linkPlaceNames('Hope Town Harbour, Elbow Reef Lighthouse, Hope Town Harbour, Hope Town. {{address:1}}', [{ name: 'Elbow Reef Lighthouse' }, { name: 'Hope Town Harbour' }, { name: 'Hope Town' }])).toBe(
      '{{place:2}}, {{place:1}}, Hope Town Harbour, {{place:3}}. {{address:1}}'
    );
  });

  it('only a full name brings a card: "Elbow Reef Lighthouse" never adds Lighthouse Cafe', async () => {
    replies = [say("Here's Elbow Reef Lighthouse, Hope Town's red-and-white lighthouse.")];
    const r = await ask('Show me the Elbow Reef Lighthouse landmark.', { caps: ['placeLinks'] });
    expect(r.stops.map((s) => s.id)).toEqual(['elbow-reef-lighthouse']);
  });

  it("search citation markup never shows, and a range reads '9 to 5'", async () => {
    replies = [say('<cite index="9-1">It opens 9–5</cite> and Elbow Reef Lighthouse is free.')];
    const r = await ask('About Elbow Reef Lighthouse in Abacos: when can I climb it?');
    expect(r.reply).not.toMatch(/cite/);
    expect(r.reply).toMatch(/9 to 5/);
  });

  it('narration instead of an answer is asked for once more, in the reply shape', async () => {
    replies = [
      { stop_reason: 'end_turn', content: [{ type: 'text', text: "Sure thing. Perfect! You've got some great options." }], usage: {} },
      say("Here's Elbow Reef Lighthouse.", []),
    ];
    const r = await ask('Show me the Elbow Reef Lighthouse landmark.');
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1)).toEqual({ role: 'user', content: JSON_ONLY });
    expect(r.reply).toBe("Here's Elbow Reef Lighthouse.");
    // A landmark ask starts on the fast model; the retry moves up.
    expect(requests[0].model).toBe('claude-haiku-4-5');
    expect(requests[1].model).toBe('claude-sonnet-5');
    expect(requests[1].thinking).toEqual({ type: 'disabled' });
  });
});
