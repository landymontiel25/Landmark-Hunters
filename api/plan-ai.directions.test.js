// "How do I get to Hillstone?" comes back with Hillstone's card (its
// Directions button sits on it), whether or not the AI listed it as a stop,
// and named imported places reach the AI as MATCHING PLACES.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let aiText = '';
let lastRequest = null;
vi.mock('./_lib/aiGuard.js', () => ({ guardAiRequest: async () => true }));
vi.mock('./_lib/aiCallLog.js', () => ({ logAiCall: async () => {} }));
vi.mock('./_lib/cors.js', () => ({ withCors: (h) => h }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (req) => {
        lastRequest = req;
        return { content: [{ type: 'text', text: aiText }], usage: { input_tokens: 1, output_tokens: 1 } };
      },
    };
  },
}));

const { default: handler } = await import('./plan-ai.js');
const { ALL_LANDMARKS } = await import('../src/data/regions.js');

async function ask(content) {
  let json;
  const res = {
    status() {
      return this;
    },
    json(j) {
      json = j;
    },
  };
  await handler({ method: 'POST', body: { messages: [{ role: 'user', content }], regionIds: ['miami'] } }, res);
  return json;
}

describe('plan-ai directions questions', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test';
    lastRequest = null;
  });

  it('adds the named place as a card when the AI answered in text only', async () => {
    aiText = JSON.stringify({ reply: 'Head west on Coral Way.', stops: [] });
    const r = await ask('How do I get to Hillstone?');
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0]).toMatchObject({ region: 'miami', name: 'Hillstone Restaurant' });
    expect(Number.isFinite(r.stops[0].lat) && Number.isFinite(r.stops[0].lng)).toBe(true);
  });

  it('adds no card when the question is not about getting there', async () => {
    aiText = JSON.stringify({ reply: 'Try these.', stops: [] });
    expect((await ask('Is Hillstone good?')).stops).toEqual([]);
  });

  it('lists named imported places and accepts them as stops', async () => {
    const cafe = ALL_LANDMARKS.find((l) => l.source === 'osm' && l.name === 'Panther Coffee');
    expect(cafe).toBeTruthy();
    aiText = JSON.stringify({ reply: "Here's Panther Coffee.", stops: [{ match: `miami/${cafe.id}`, reason: 'Tap Directions.' }] });
    const r = await ask('directions to Panther Coffee');
    const system = lastRequest.system.map((b) => b.text).join('\n');
    expect(system).toMatch(/MATCHING PLACES/);
    expect(system).toContain(`miami/${cafe.id}`);
    // Imported places stay out of the cached catalog block.
    expect(lastRequest.system.find((b) => b.cache_control).text).not.toContain('osm-');
    expect(r.stops[0]).toMatchObject({ id: cafe.id, name: 'Panther Coffee', source: 'osm' });
  });
});
