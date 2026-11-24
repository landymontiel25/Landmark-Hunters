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

describe('a question about one place is answered about that place only (owner, 2026-11-24)', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test';
    requests.length = 0;
  });
  // A searched reply carries its results, the way the API returns them.
  const sayStops = (reply, stops, searches = 1) => ({
    stop_reason: 'end_turn',
    content: [
      ...(searches ? [{ type: 'web_search_tool_result', tool_use_id: 'ws', content: stops.filter((st) => st.url).map((st) => ({ type: 'web_search_result', url: st.url, title: st.name })) }] : []),
      { type: 'text', text: JSON.stringify({ reply, stops }) },
    ],
    usage: { server_tool_use: { web_search_requests: searches } },
  });

  it('knows which questions are about one place', async () => {
    const { placeQuestionTarget } = await import('./plan-ai.js');
    const places = [{ name: 'Nippers', regionId: 'abacos', id: 'nippers' }, { name: 'Grabbers', regionId: 'abacos', id: 'grabbers' }];
    expect(placeQuestionTarget(Q, places)).toBe('Man-O-War settlement');
    expect(placeQuestionTarget('Is there a pool at Nippers?', places)).toBe('Nippers');
    expect(placeQuestionTarget("What's good near Nippers?", places)).toBeNull();
    expect(placeQuestionTarget('Nippers or Grabbers for lunch?', places)).toBeNull();
    expect(placeQuestionTarget('Where should I eat after Nippers?', places)).toBeNull();
    expect(placeQuestionTarget('lunch in the abacos?', places)).toBeNull();
  });

  it('sends back a reply that brings in another place, and keeps only that place', async () => {
    replies = [
      sayStops("I searched and couldn't find tennis courts at Man-O-War. Abaco Beach Resort nearby has courts.", [{ external: true, name: 'Abaco Beach Resort', url: 'https://example.com' }]),
      sayStops("I searched and couldn't find whether Man-O-War settlement has tennis courts.", []),
    ];
    const r = await ask([{ role: 'user', content: Q }]);
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1).content).toMatch(/Answer about Man-O-War settlement only/);
    expect(r.reply).not.toMatch(/Abaco Beach Resort/);
    // Only the place asked about, as its card (owner, 2026-11-24).
    expect(r.stops.map((st) => st.id)).toEqual(['man-o-war-settlement']);
  });

  it('drops another place that is still there after the retry, card and sentence', async () => {
    const both = sayStops("I searched and couldn't find tennis courts at Man-O-War. Abaco Beach Resort nearby has courts.", [{ external: true, name: 'Abaco Beach Resort', url: 'https://example.com' }]);
    replies = [both, both];
    const r = await ask([{ role: 'user', content: Q }]);
    expect(r.reply).toBe("I searched and couldn't find tennis courts at Man-O-War.");
    expect(r.stops.every((st) => st.id === 'man-o-war-settlement')).toBe(true);
  });

  it('leaves other questions alone', async () => {
    replies = [sayStops('Try Nippers and Grabbers.', [{ external: true, name: 'Nippers', url: 'https://a.com' }, { external: true, name: 'Grabbers', url: 'https://b.com' }])];
    const r = await ask([{ role: 'user', content: 'lunch spots in the abacos?' }]);
    expect(requests).toHaveLength(1);
    expect(r.stops.map((s) => s.name)).toEqual(['Nippers', 'Grabbers']);
  });
});

describe('withoutPlaces', () => {
  it('cuts the sentences about somewhere else and keeps the answer', async () => {
    const { withoutPlaces } = await import('./plan-ai.js');
    const places = [{ name: 'Abaco Beach Resort & Boat Harbour Marina', regionId: 'abacos', id: 'abaco-beach-resort' }];
    const live = "I searched and couldn't find whether Man-O-War settlement has tennis courts. The settlement's known for its boat-building heritage rather than sports facilities, but Abaco Beach Resort nearby has tennis courts available.";
    expect(withoutPlaces(live, 'Man-O-War settlement', { places })).toBe("I searched and couldn't find whether Man-O-War settlement has tennis courts.");
    const stays = "I searched and couldn't find whether Nippers has a pool. Nippers is a beach bar on Great Guana Cay, so it's beach-focused.";
    expect(withoutPlaces(stays, 'Nippers', { places })).toBe(stays);
  });
});

