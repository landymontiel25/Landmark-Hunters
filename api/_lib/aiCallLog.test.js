import { describe, it, expect, vi, afterEach } from 'vitest';
import { aiCallEntry, logAiCall } from './aiCallLog.js';

afterEach(() => vi.restoreAllMocks());

describe('AI call log', () => {
  it('keeps only the feature, model and token counts', () => {
    const entry = aiCallEntry({
      feature: 'plan-ai',
      model: 'claude-haiku-4-5',
      usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 5000 },
    });
    expect(entry).toMatchObject({
      feature: 'plan-ai',
      model: 'claude-haiku-4-5',
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadInputTokens: 5000,
      cacheCreationInputTokens: 0,
    });
    expect(Object.keys(entry).sort()).toEqual(
      ['at', 'cacheCreationInputTokens', 'cacheReadInputTokens', 'feature', 'inputTokens', 'model', 'outputTokens'].sort()
    );
  });

  it('writes the entry to ai_call_log and never throws when Firestore fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const add = vi.fn(async () => {});
    const db = { collection: vi.fn(() => ({ add })) };
    await logAiCall({ feature: 'interest-classifier', model: 'm', usage: { input_tokens: 1, output_tokens: 2 } }, { db });
    expect(db.collection).toHaveBeenCalledWith('ai_call_log');
    expect(add.mock.calls[0][0]).toMatchObject({ feature: 'interest-classifier', inputTokens: 1, outputTokens: 2 });

    const broken = { collection: () => ({ add: async () => { throw new Error('nope'); } }) };
    await expect(logAiCall({ feature: 'plan-ai', model: 'm', usage: null }, { db: broken })).resolves.toBeTruthy();
  });
});
