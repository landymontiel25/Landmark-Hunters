import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = { create: createMock };
    }
  },
}));

const { enrichLandmark, cleanEnrichedTopic, ENRICHMENT_INSTRUCTIONS } = await import('./enrichLandmark.js');

function replyWith(obj) {
  createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
}

const BASE = { summary: 'A small Peruvian spot.', facts: ['Serves ceviche'], free: true, category: null, typicalMinutes: 60 };

describe('enrichLandmark topic', () => {
  beforeEach(() => createMock.mockReset());

  it('asks the model for a topic', () => {
    expect(ENRICHMENT_INSTRUCTIONS).toContain('"topic"');
  });

  it('passes a researched topic through', async () => {
    replyWith({ ...BASE, topic: 'Peruvian restaurant' });
    const out = await enrichLandmark({ name: 'Inka Grill', lat: 1, lng: 2, hasPhoto: true });
    expect(out.topic).toBe('Peruvian restaurant');
    expect(out.summary).toBe('A small Peruvian spot.');
  });

  it('returns null, without breaking the rest, when the topic is missing or null', async () => {
    replyWith({ ...BASE });
    const missing = await enrichLandmark({ name: 'Somewhere', lat: 1, lng: 2, hasPhoto: true });
    expect(missing.topic).toBeNull();
    expect(missing.typicalMinutes).toBe(60);

    replyWith({ ...BASE, topic: null });
    const nulled = await enrichLandmark({ name: 'Somewhere', lat: 1, lng: 2, hasPhoto: true });
    expect(nulled.topic).toBeNull();
    expect(nulled.facts).toEqual(['Serves ceviche']);
  });

  it('cleans citation markup and articles, and drops sentences', () => {
    expect(cleanEnrichedTopic('<cite index="1">sports bar</cite>')).toBe('sports bar');
    expect(cleanEnrichedTopic('A go-kart track.')).toBe('go-kart track');
    expect(cleanEnrichedTopic('null')).toBeNull();
    expect(cleanEnrichedTopic(42)).toBeNull();
    expect(cleanEnrichedTopic('This is a restaurant that serves a lot of different kinds of food')).toBeNull();
  });
});

describe('enrichLandmark typicalMinutes', () => {
  beforeEach(() => createMock.mockReset());

  it('leaves typicalMinutes null when the model returns null (not a bogus 5-minute visit)', async () => {
    replyWith({ ...BASE, typicalMinutes: null });
    const out = await enrichLandmark({ name: 'Somewhere', lat: 1, lng: 2, hasPhoto: true });
    expect(out.typicalMinutes).toBeNull();
  });

  it('still clamps real values', async () => {
    replyWith({ ...BASE, typicalMinutes: 1000 });
    const out = await enrichLandmark({ name: 'Somewhere', lat: 1, lng: 2, hasPhoto: true });
    expect(out.typicalMinutes).toBe(300);
  });
});
