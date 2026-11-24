// Speed (owner, 2026-11-24): a reply carries only the catalog cities the
// message is about and the app guide only for questions about the app.
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
const { default: handler, focusRegionIds, ABOUT_THE_APP } = await import('./plan-ai.js');
const { ALL_LANDMARKS } = await import('../src/data/regions.js');
const { APP_HELP } = await import('./_lib/appHelp.js');
const curated = ALL_LANDMARKS.filter((l) => l.source !== 'osm');

const say = (reply) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ reply, stops: [] }) }], usage: {} });
async function ask(content, extra = {}) {
  let json;
  const res = { status() { return this; }, json(j) { json = j; } };
  await handler({ method: 'POST', body: { messages: [{ role: 'user', content }], ...extra } }, res);
  return json;
}
const systemText = (r) => r.system.map((b) => b.text).join('\n');

describe('only what the message needs', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test';
    requests.length = 0;
  });

  it('picks the cities: where they are, the ones they name, else all', () => {
    expect(focusRegionIds('Where should I eat?', curated, { lat: 26.73, lng: -77.39 })).toEqual(['abacos']);
    expect(focusRegionIds("What's good in Paris?", curated, null)).toEqual(['paris']);
    expect(focusRegionIds('Is Elbow Reef Lighthouse worth it?', curated, null)).toEqual(['abacos']);
    expect(focusRegionIds('hi', curated, null)).toEqual([]);
  });

  it('a dinner ask in the Abacos sends the Abacos catalog only and no app guide', async () => {
    replies = [say('Try Sunset Pizza.')];
    await ask('Where should I eat dinner tonight?', { location: { lat: 26.73, lng: -77.39 } });
    const sys = systemText(requests[0]);
    expect(sys).toMatch(/abacos\/elbow-reef-lighthouse/);
    expect(sys).not.toMatch(/paris\//);
    expect(sys).not.toContain(APP_HELP.slice(0, 200));
  });

  it('a question about the app gets the app guide', async () => {
    replies = [say('Tap Check In on the place.')];
    await ask('How do I check in?');
    expect(systemText(requests[0])).toContain(APP_HELP.slice(0, 200));
    expect(ABOUT_THE_APP.test('Where should I eat dinner tonight?')).toBe(false);
    expect(ABOUT_THE_APP.test('How does my streak work?')).toBe(true);
  });

  it('a plain hello is answered as it is, no retry', async () => {
    replies = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hey! What are you in the mood for today?' }], usage: {} }];
    const r = await ask('hi');
    expect(requests).toHaveLength(1);
    expect(r.reply).toBe('Hey! What are you in the mood for today?');
  });
});
