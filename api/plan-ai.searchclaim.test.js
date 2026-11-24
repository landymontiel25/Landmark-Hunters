// The Treasure Cay case (owner, 2026-11-24): Mapr said it would search, then
// named "Sunset Pizza" without searching. A search it claims or needs has to
// run before it answers, and a place outside the app has to come from the
// results, or it never reaches the traveler.
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
const { default: handler, SEARCH_FIRST, ONLY_FROM_RESULTS, SAYS_SEARCHED } = await import('./plan-ai.js');

const Q = 'Where should I eat dinner in Treasure Cay? I love steak and pizza.';
async function ask() {
  let json;
  const res = { status() { return this; }, json(j) { json = j; } };
  await handler({ method: 'POST', body: { messages: [{ role: 'user', content: Q }], caps: ['placeLinks'], location: { lat: 26.73, lng: -77.39, label: 'Treasure Cay' } } }, res);
  return json;
}
const noSearch = (reply, stops = []) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ reply, stops }) }], usage: {} });
const searched = (reply, stops, results) => ({
  stop_reason: 'end_turn',
  content: [
    { type: 'server_tool_use', id: 'ws1', name: 'web_search', input: { query: 'pizza steak restaurants Treasure Cay' } },
    { type: 'web_search_tool_result', tool_use_id: 'ws1', content: results.map(([url, title]) => ({ type: 'web_search_result', url, title })) },
    { type: 'text', text: JSON.stringify({ reply, stops }) },
  ],
  usage: { server_tool_use: { web_search_requests: 1 } },
});
const invented = { name: 'Sunset Pizza', place: 'Treasure Cay', url: 'https://www.treasuresandsclub.com/sunset-pizza', reason: 'Pizza' };

describe('a search Mapr claims or needs actually runs first', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test';
    requests.length = 0;
  });

  it('"let me search" plus a place, with no search: sent back with the search required, and the searched answer comes from the results', async () => {
    replies = [
      noSearch("Let me search for spots in Treasure Cay. Sunset Pizza is your best bet.", [invented]),
      searched('Coconuts Grill does steaks on the water, and it came up first for Treasure Cay.', [{ name: 'Coconuts Grill', place: 'Treasure Cay', url: 'https://example.org/coconuts-grill', reason: 'Steak' }], [['https://example.org/coconuts-grill', 'Coconuts Grill, Treasure Cay']]),
    ];
    const r = await ask();
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1)).toEqual({ role: 'user', content: SEARCH_FIRST });
    expect(requests[1].tool_choice).toEqual({ type: 'tool', name: 'web_search' });
    expect(r.stops).toEqual([expect.objectContaining({ external: true, name: 'Coconuts Grill', url: 'https://example.org/coconuts-grill' })]);
    expect(r.reply).toMatch(/\{\{place:1\}\} does steaks/);
    expect(r.reply).not.toMatch(/Sunset Pizza/);
  });

  it('when it still never searches, no invented place is shown and Mapr says so', async () => {
    replies = [noSearch("I'll look that up. Sunset Pizza is great.", [invented]), noSearch('Sunset Pizza is great.', [invented])];
    const r = await ask();
    expect(r.stops).toEqual([]);
    expect(r.reply).toBe("I couldn't run a search just now, so I won't guess a place. Ask me again in a moment.");
  });

  it('a place the search results never mention is sent back once, then dropped with its sentence', async () => {
    const off = searched('Sunset Pizza has great pies. I searched Treasure Cay for you.', [invented], [['https://example.org/other', 'Treasure Cay beaches']]);
    replies = [off, off];
    const r = await ask();
    expect(requests[1].messages.at(-1)).toEqual({ role: 'user', content: ONLY_FROM_RESULTS });
    expect(r.stops).toEqual([]);
    expect(r.reply).toBe("I searched but didn't find a place I can point you to for that. Want me to look for a different kind of place?");
  });

  it('a real search with the place in its results goes straight through', async () => {
    replies = [searched('Sunset Pizza is the pizza spot that came up for Treasure Cay.', [invented], [['https://treasuresandsclub.com/sunset-pizza/', 'Sunset Pizza | Treasure Sands Club']])];
    const r = await ask();
    expect(requests).toHaveLength(1);
    expect(r.stops[0]).toMatchObject({ name: 'Sunset Pizza', url: invented.url });
  });

  it('knows a search claim when it sees one', () => {
    for (const t of ['Let me search for that.', "I'll look it up.", 'I searched and found two spots.', 'The search results show three places.']) expect(SAYS_SEARCHED.test(t)).toBe(true);
    for (const t of ['Try Nippers.', 'It opens at 9.']) expect(SAYS_SEARCHED.test(t)).toBe(false);
  });
});
