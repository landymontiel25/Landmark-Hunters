// Mapr looks a missing place detail up on the first ask (owner, 2026-11-24):
// never "I don't have that detail in the app's data", always a search.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requests = [];
let replies = [];
vi.mock('./_lib/aiGuard.js', () => ({ guardAiRequest: async () => true }));
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

const { default: handler, SAYS_NO_DATA, SEARCH_INSTEAD } = await import('./plan-ai.js');

async function ask(messages) {
  let json;
  const res = { status() { return this; }, json(j) { json = j; } };
  await handler({ method: 'POST', body: { messages, regionIds: ['abacos'] } }, res);
  return json;
}
const say = (reply, searches = 0) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ reply, stops: [] }) }], usage: searches ? { server_tool_use: { web_search_requests: searches } } : {} });
const Q = 'About Man-O-War settlement in Abacos: Are there tennis courts?';

describe('Mapr searches instead of saying it lacks a detail', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test';
    requests.length = 0;
  });

  it('tells Mapr to search a missing detail right away and never to say it lacks the data', async () => {
    replies = [say('Man-O-War has no tennis courts.', 1)];
    await ask([{ role: 'user', content: Q }]);
    const system = requests[0].system.map((b) => b.text).join('\n');
    expect(system).toMatch(/call web_search right away/);
    expect(system).toMatch(/Never say you don't have that detail/);
    expect(requests[0].tools.map((t) => t.name)).toContain('web_search');
    // A place question is about that place only (owner, 2026-11-24): no
    // nearby alternative, even when the search finds nothing.
    expect(system).toMatch(/mention only that place in "reply" and "stops", never a nearby alternative/);
    expect(system).not.toMatch(/close alternative you did find/);
  });

  it('a "no data" reply with no search goes back once with the search required, and the searched answer shows', async () => {
    replies = [
      say("I don't have that detail in the app's data for Man-O-War settlement."),
      say("There aren't tennis courts at Man-O-War settlement itself. Abaco Beach Resort turned its courts into pickleball courts.", 1),
    ];
    const r = await ask([{ role: 'user', content: Q }]);
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1)).toEqual({ role: 'user', content: SEARCH_INSTEAD });
    expect(SEARCH_INSTEAD).toMatch(/Mention only the place I asked about/);
    expect(r.reply).toMatch(/pickleball/);
    expect(r.reply).not.toMatch(SAYS_NO_DATA);
  });

  it('works for any other missing detail too', async () => {
    replies = [say("I don't have info on parking at Elbow Reef Lighthouse."), say("I searched: there's no parking at the lighthouse; visitors leave cars by the Hope Town ferry dock.", 1)];
    const r = await ask([{ role: 'user', content: 'About Elbow Reef Lighthouse in Abacos: Is there parking?' }]);
    expect(requests).toHaveLength(2);
    expect(r.reply).toMatch(/parking/);
  });

  it('leaves a reply alone when it already searched, or never claimed to lack anything', async () => {
    replies = [say("I searched and couldn't find whether Man-O-War has tennis courts.", 1)];
    await ask([{ role: 'user', content: Q }]);
    replies = [say('Try Hope Town for lunch.')];
    await ask([{ role: 'user', content: 'lunch in the abacos?' }]);
    expect(requests).toHaveLength(2);
  });

  it('spots the "no data" phrasings and nothing else', () => {
    for (const t of ["I don't have that detail in the app's data.", 'I don’t have the data for that.', "That isn't in the app's data.", 'I do not have any information on that.']) expect(SAYS_NO_DATA.test(t)).toBe(true);
    for (const t of ["I searched and couldn't find it.", "You don't have a Miami itinerary yet.", "I don't have a rating history for you yet."]) expect(SAYS_NO_DATA.test(t)).toBe(false);
  });
});
