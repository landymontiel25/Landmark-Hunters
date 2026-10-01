import { describe, it, expect, vi, beforeEach } from 'vitest';

let modelReply = '';
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async () => ({ content: [{ type: 'text', text: modelReply }], usage: {} }),
    };
  },
}));
vi.mock('../../api/_lib/aiGuard.js', () => ({ guardAiRequest: async () => ({ uid: 'me' }) }));

import handler from '../../api/plan-ai.js';

const run = () =>
  new Promise((resolve) => {
    const res = {
      status(code) {
        this.code = code;
        return this;
      },
      json(data) {
        resolve({ code: this.code, data });
      },
    };
    handler({ method: 'POST', body: { messages: [{ role: 'user', content: 'plan me a day' }] }, headers: {} }, res);
  });

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test';
});

describe('plan-ai when the model reply is cut off mid-JSON', () => {
  it('shows the reply text, not raw JSON', async () => {
    modelReply = '{"reply": "Start at the park, then lunch nearby.", "stops": [{"match": "miami/wyn';
    const { data } = await run();
    expect(data.reply).toBe('Start at the park, then lunch nearby.');
    expect(data.stops).toEqual([]);
  });

  it('never shows a bare JSON blob when no reply can be recovered', async () => {
    modelReply = '{"stops": [{"match": "miami/wyn';
    const { data } = await run();
    expect(data.reply).not.toContain('{');
    expect(data.reply.length).toBeGreaterThan(0);
  });

  it('keeps plain prose replies as they are', async () => {
    modelReply = 'Sure, happy to help!';
    const { data } = await run();
    expect(data.reply).toBe('Sure, happy to help!');
  });
});
