// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const added = [];
vi.mock('firebase/firestore', () => ({
  addDoc: async (_c, data) => {
    added.push(data);
  },
  collection: (_db, name) => ({ name }),
  serverTimestamp: () => 'TS',
}));
vi.mock('./firebase', () => ({ db: {} }));

import { isRequestFor, normalizeRequestFor, tasteContextFor } from './requestFor';
import { recommendationEntries, logRecommendations, resetShownMemory } from './recommendationLog';
import { tasteInputsOf, requestForOf, GROUP_REQUEST_TEXT } from '../../api/plan-ai.js';

const taste = {
  reviews: [{ name: 'Autana', tier: 'highly-recommend' }],
  interests: ['food'],
  tasteIntro: 'I love tacos',
  insiderMode: true,
  tagScoreSummary: { philly: { food: 40 } },
};
const stop = (id) => ({ id, region: 'villanova', name: id, categories: ['food'] });

beforeEach(() => {
  added.length = 0;
  localStorage.clear();
  resetShownMemory();
});

describe('request type', () => {
  it('only solo and group are valid; anything else is solo', () => {
    expect(isRequestFor('group')).toBe(true);
    expect(isRequestFor('family')).toBe(false);
    expect(normalizeRequestFor('group')).toBe('group');
    expect(normalizeRequestFor(undefined)).toBe('solo');
    expect(normalizeRequestFor('family')).toBe('solo');
  });
});

describe('client payload', () => {
  it('a solo request sends the usual taste context unchanged', () => {
    expect(tasteContextFor('solo', taste)).toEqual(taste);
  });
  it('a group request sends no taste context at all', () => {
    expect(tasteContextFor('group', taste)).toEqual({ reviews: [], interests: [], tasteIntro: '', insiderMode: false, tagScoreSummary: {} });
  });
});

describe('api/plan-ai taste inputs', () => {
  it('solo (or no requestFor, as old app builds send) keeps the taste', () => {
    expect(requestForOf({})).toBe('solo');
    expect(tasteInputsOf({ ...taste })).toEqual(taste);
    expect(tasteInputsOf({ ...taste, requestFor: 'solo' })).toEqual(taste);
  });
  it('group ignores every taste field, even if a client sent them', () => {
    expect(requestForOf({ requestFor: 'group' })).toBe('group');
    expect(tasteInputsOf({ ...taste, requestFor: 'group' })).toEqual({ reviews: [], interests: [], tasteIntro: '', insiderMode: false, tagScoreSummary: {} });
  });
  it('the group prompt tells the model to follow the ask, not the usual taste', () => {
    expect(GROUP_REQUEST_TEXT).toMatch(/Follow exactly what they asked for/);
    expect(GROUP_REQUEST_TEXT).toMatch(/Do NOT use the traveler's own taste/);
  });
});

describe('requestFor is logged on the picks', () => {
  it('is written for solo and group, and left off when not given or invalid', () => {
    const base = { uid: 'u', source: 'chat', surface: 'chat', setId: 'S', stops: [stop('a')] };
    expect(recommendationEntries({ ...base, requestFor: 'group' })[0].requestFor).toBe('group');
    expect(recommendationEntries({ ...base, requestFor: 'solo' })[0].requestFor).toBe('solo');
    expect(recommendationEntries(base)[0]).not.toHaveProperty('requestFor');
    expect(recommendationEntries({ ...base, requestFor: 'family' })[0]).not.toHaveProperty('requestFor');
  });
  it('reaches the stored row', async () => {
    await logRecommendations({ uid: 'u', source: 'chat', surface: 'chat', setId: 'S', stops: [stop('a'), stop('b')], requestFor: 'group' });
    expect(added.map((r) => r.requestFor)).toEqual(['group', 'group']);
  });
});
