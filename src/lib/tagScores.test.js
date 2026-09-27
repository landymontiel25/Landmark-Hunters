import { describe, it, expect } from 'vitest';
import { ALL_LANDMARKS } from '../data/regions';
import {
  applyRating,
  buildShortlist,
  coldStartShortlist,
  decayFactor,
  effectiveTagScores,
  pendingCapPrompt,
  pickRegion,
  rebuildTagScores,
  scoreShortlist,
  settleShownPicks,
  localTagPicks,
  localSwipePicks,
  swipeShortlist,
  noteKeywords,
  globalPopularPicks,
  capMaps,
  TAG_FLOOR,
  timeSlotFor,
  applyTimeSlot,
  TAG_CAP,
} from './tagScores';

const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 1);

describe('applyRating', () => {
  it('applies +10 / +2 / -15 per tag', () => {
    expect(applyRating({}, ['food'], 'highly-recommend', T0).scores).toEqual({ food: 10 });
    expect(applyRating({}, ['food'], 'worth-trying', T0).scores).toEqual({ food: 2 });
    expect(applyRating({}, ['food'], 'probably-skip', T0).scores).toEqual({ food: -15 });
  });

  it('ignores ratings without a known tier', () => {
    expect(applyRating({}, ['food'], null, T0).scores).toEqual({});
  });

  it('decays the old score before adding the new rating', () => {
    const next = applyRating({ scores: { food: 10 }, at: { food: T0 } }, ['food'], 'highly-recommend', T0 + 90 * DAY);
    expect(next.scores.food).toBeCloseTo(15);
  });

  it('caps at 100 and reports the tag that hit it', () => {
    let state = { scores: {}, at: {}, counts: {} };
    let capped = [];
    for (let i = 0; i < 20; i++) {
      const next = applyRating(state, ['food'], 'highly-recommend', T0);
      state = {
        scores: { ...state.scores, ...next.scores },
        at: { ...state.at, ...next.at },
        counts: { ...state.counts, ...next.counts },
      };
      capped = next.capped;
    }
    expect(state.scores.food).toBe(TAG_CAP);
    expect(state.counts.food).toBe(20);
    expect(capped).toEqual(['food']);
  });

  it('counts ratings after the 5th on a tag at half value', () => {
    const fifth = applyRating({ scores: { food: 40 }, at: { food: T0 }, counts: { food: 4 } }, ['food'], 'highly-recommend', T0);
    expect(fifth.scores.food).toBe(50);
    const sixth = applyRating({ scores: { food: 50 }, at: { food: T0 }, counts: { food: 5 } }, ['food'], 'highly-recommend', T0);
    expect(sixth.scores.food).toBe(55);
    expect(sixth.counts.food).toBe(6);
  });
});

describe('cross-region warm start', () => {
  const miamiFood = { tagScores: { miami: { food: 100 } }, tagScoresAt: { miami: { food: T0 } } };

  it('borrows 40% of other regions in a brand-new region', () => {
    expect(effectiveTagScores(miamiFood, 'milan', T0).food).toBeCloseTo(40);
  });

  it('fades out as local ratings reach 15', () => {
    const half = { ...miamiFood, tagCounts: { milan: { 'art-museums': 7.5 } } };
    expect(effectiveTagScores(half, 'milan', T0).food).toBeCloseTo(20);
    const done = { ...miamiFood, tagCounts: { milan: { 'art-museums': 15 } } };
    expect(effectiveTagScores(done, 'milan', T0).food).toBeUndefined();
  });

  it('turns cold start off once any other region has signal', () => {
    expect(buildShortlist({ profile: miamiFood, region: 'milan', now: T0 }).coldStart).toBe(false);
  });
});

describe('decay and boosts', () => {
  it('halves a score every 90 days', () => {
    expect(decayFactor(T0, T0 + 90 * DAY)).toBeCloseTo(0.5);
    const profile = { tagScores: { milan: { food: 100 } }, tagScoresAt: { milan: { food: T0 } } };
    expect(effectiveTagScores(profile, 'milan', T0 + 90 * DAY).food).toBeCloseTo(50);
  });

  it('applies the 1.5x boost above the cap in ranking only', () => {
    const profile = {
      tagScores: { milan: { food: 100 } },
      tagScoresAt: { milan: { food: T0 } },
      tagBoosts: { milan: { food: 'yes' } },
    };
    expect(effectiveTagScores(profile, 'milan', T0).food).toBe(150);
    expect(profile.tagScores.milan.food).toBe(100);
  });

  it('keeps regions separate once a region has 15 ratings of its own', () => {
    const profile = {
      tagScores: { milan: { food: 40 }, miami: { 'art-museums': 10 } },
      tagScoresAt: { milan: { food: T0 }, miami: { 'art-museums': T0 } },
      tagCounts: { miami: { 'art-museums': 15 } },
    };
    expect(effectiveTagScores(profile, 'miami', T0)).toEqual({ 'art-museums': 10 });
  });
});

describe('score floor', () => {
  it('never drops below -100', () => {
    let state = { scores: {}, at: {}, counts: {} };
    for (let i = 0; i < 20; i++) {
      const next = applyRating(state, ['food'], 'probably-skip', T0);
      state = { scores: next.scores, at: next.at, counts: next.counts };
    }
    expect(state.scores.food).toBe(TAG_FLOOR);
  });
});

describe('global cap answers', () => {
  it('asks once per tag, whichever region hit the cap', () => {
    const profile = { tagScores: { milan: { food: 100 }, miami: { food: 100 } }, capAnswers: { food: 'no' } };
    expect(pendingCapPrompt(profile)).toBeNull();
  });

  it('applies a yes in every region', () => {
    const profile = {
      tagScores: { milan: { food: 60 }, miami: { food: 100 } },
      tagScoresAt: { milan: { food: T0 }, miami: { food: T0 } },
      tagCounts: { milan: { food: 15 } },
      capAnswers: { food: 'yes' },
    };
    expect(effectiveTagScores(profile, 'milan', T0).food).toBeCloseTo(90);
  });

  it('still reads answers saved in the older per-region form', () => {
    const profile = { tagBoosts: { miami: { food: 'yes' } }, tagNotes: { miami: { food: 'more tacos' } } };
    expect(capMaps(profile)).toEqual({ answers: { food: 'yes' }, notes: { food: 'more tacos' } });
    expect(pendingCapPrompt({ ...profile, tagScores: { milan: { food: 100 } } })).toBeNull();
  });
});

describe('localTagPicks', () => {
  it('follows the shortlist order and slots in one wildcard', () => {
    const profile = { tagScores: { milan: { food: 60 } }, tagScoresAt: { milan: { food: Date.now() } } };
    const picks = localTagPicks({ profile, region: 'milan', limit: 10 });
    expect(picks).toHaveLength(10);
    expect(picks[0].categories[0]).toBe('food');
    expect(picks.filter((p) => p.wildcard)).toHaveLength(1);
    expect(picks.every((p) => p.region === 'milan')).toBe(true);
  });

  it('returns nothing without a region', () => {
    expect(localTagPicks({ profile: {}, region: null })).toEqual([]);
  });
});

describe('pendingCapPrompt', () => {
  it('asks about a capped tag until it is answered', () => {
    const profile = { tagScores: { milan: { food: 100, 'art-museums': 40 } } };
    expect(pendingCapPrompt(profile)).toEqual({ region: 'milan', tag: 'food' });
    expect(pendingCapPrompt({ ...profile, tagBoosts: { milan: { food: 'no' } } })).toBeNull();
  });
});

describe('rebuildTagScores', () => {
  it('matches replaying the same ratings live', () => {
    const reviews = [
      { region: 'milan', categories: ['food'], ratingTier: 'probably-skip', updatedAt: { seconds: (T0 + 30 * DAY) / 1000 } },
      { region: 'milan', categories: ['food'], ratingTier: 'highly-recommend', updatedAt: { seconds: T0 / 1000 } },
    ];
    const { tagScores, tagScoresAt } = rebuildTagScores(reviews);
    const first = applyRating({}, ['food'], 'highly-recommend', T0);
    const second = applyRating(first, ['food'], 'probably-skip', T0 + 30 * DAY);
    expect(tagScores.milan.food).toBeCloseTo(second.scores.food);
    expect(tagScoresAt.milan.food).toBe(T0 + 30 * DAY);
  });
});

describe('shortlists', () => {
  const milan = ALL_LANDMARKS.filter((l) => l.regionId === 'milan');
  const topTag = 'food';

  it('ranks the highest-scoring tag first, excludes visited, caps at 30', () => {
    const visited = milan.find((l) => l.categories[0] === topTag).id;
    const list = scoreShortlist({ scores: { [topTag]: 50, 'history-culture': -20 }, region: 'milan', excludeIds: [visited] });
    expect(list.length).toBeLessThanOrEqual(30);
    expect(list[0].categories[0]).toBe(topTag);
    expect(list.some((l) => l.id === visited)).toBe(false);
    expect(list.every((l) => l.regionId === 'milan')).toBe(true);
  });

  it('limits one tag to 12 of the 30 slots, 18 when boosted', () => {
    const scores = { 'history-culture': 90, food: 10, 'art-museums': 5 };
    const count = (list, tag) => list.filter((l) => l.categories[0] === tag).length;
    const plain = scoreShortlist({ scores, region: 'milan' });
    expect(plain).toHaveLength(30);
    expect(count(plain, 'history-culture')).toBe(12);
    const boosted = scoreShortlist({ scores, region: 'milan', boostedTags: ['history-culture'] });
    expect(count(boosted, 'history-culture')).toBe(18);
  });

  it('fills leftover slots from held-back places in a small region', () => {
    const list = scoreShortlist({ scores: { 'history-culture': 90 }, region: 'milan', limit: 500 });
    expect(list).toHaveLength(milan.filter((l) => l.categories[0] !== 'dorms').length);
  });

  it('ranks a close score backed by more ratings first', () => {
    const list = scoreShortlist({
      scores: { food: 10, 'art-museums': 11 },
      tagCounts: { food: 20, 'art-museums': 1 },
      region: 'milan',
    });
    expect(list[0].categories[0]).toBe('food');
    expect(list[0].tagRatings).toBe(20);
  });

  it('holds 4 wildcard slots for barely-rated, not-disliked tags', () => {
    const scores = { 'history-culture': 90, food: 10, 'art-museums': 5, 'parks-nature': -10 };
    const list = scoreShortlist({ scores, region: 'milan', random: () => 0 });
    const wild = list.filter((l) => l.wildcard);
    expect(list).toHaveLength(30);
    expect(wild).toHaveLength(4);
    expect(new Set(wild.map((l) => l.categories[0])).size).toBe(4);
    for (const l of wild) {
      expect(['history-culture', 'food', 'art-museums', 'parks-nature']).not.toContain(l.categories[0]);
    }
  });

  it('breaks ties by check-in count', () => {
    const foods = milan.filter((l) => l.categories[0] === 'food');
    const underdog = foods.at(-1);
    const list = scoreShortlist({ scores: { food: 10 }, region: 'milan', checkinCounts: { [underdog.id]: 99 } });
    expect(list[0].id).toBe(underdog.id);
  });

  it('cold start puts signup interests first, most-visited first', () => {
    const arts = milan.filter((l) => l.categories[0] === 'art-museums');
    const busiest = arts.at(-1);
    const list = coldStartShortlist({ region: 'milan', interests: ['art-museums'], checkinCounts: { [busiest.id]: 7 } });
    expect(list[0].id).toBe(busiest.id);
    expect(list.slice(0, arts.length).every((l) => l.categories[0] === 'art-museums')).toBe(true);
  });

  it('uses cold start only when the region has no rating signal', () => {
    expect(buildShortlist({ profile: {}, region: 'milan' }).coldStart).toBe(true);
    const profile = { tagScores: { milan: { food: 10 } }, tagScoresAt: { milan: { food: Date.now() } } };
    expect(buildShortlist({ profile, region: 'milan' }).coldStart).toBe(false);
  });

  it('never shortlists dorms or campus-life', () => {
    const list = coldStartShortlist({ region: 'villanova', limit: 500 });
    expect(list.some((l) => ['dorms', 'campus-life'].includes(l.categories[0]))).toBe(false);
  });
});

describe('pickRegion', () => {
  it('finds the region nearest a GPS fix, else falls back', () => {
    expect(pickRegion({ origin: { lat: 45.4642, lng: 9.19 } })).toBe('milan');
    expect(pickRegion({ origin: null, fallbackRegions: [undefined, 'miami'] })).toBe('miami');
  });

  it("skips a region you've already done everything in for the next-nearest one", () => {
    const villanova = { lat: 40.0356, lng: -75.3437 };
    expect(pickRegion({ origin: villanova, excludeIds: [] })).toBe('villanova');
    const allVillanova = ALL_LANDMARKS.filter((l) => l.regionId === 'villanova').map((l) => l.id);
    const next = pickRegion({ origin: villanova, excludeIds: allVillanova });
    expect(next).not.toBe('villanova');
    expect(next).toBe('philly');
  });

  it('is null when nothing anywhere is left, rather than an empty region', () => {
    expect(pickRegion({ origin: null, fallbackRegions: ['villanova'], excludeIds: ALL_LANDMARKS.map((l) => l.id) })).toBeNull();
  });
});

describe('settleShownPicks', () => {
  const lm = ALL_LANDMARKS.find((l) => l.regionId === 'milan' && l.categories[0] === 'food');

  it('counts a pick shown on an earlier day and not visited as one ignore', () => {
    const profile = { picksShown: { milan: { [lm.id]: '2026-09-24' } } };
    const out = settleShownPicks(profile, { today: '2026-09-25' });
    expect(out.changed).toBe(true);
    expect(out.timesShownNotVisited.milan[lm.id]).toBe(1);
    expect(out.picksShown).toEqual({});
    expect(out.scorePatches).toEqual([]);
  });

  it('leaves today alone and resets the count after a visit', () => {
    const profile = {
      picksShown: { milan: { [lm.id]: '2026-09-25' } },
      timesShownNotVisited: { milan: { other: 2 } },
    };
    const out = settleShownPicks(profile, { today: '2026-09-25', engagedIds: ['other'] });
    expect(out.picksShown.milan[lm.id]).toBe('2026-09-25');
    expect(out.timesShownNotVisited).toEqual({});
  });

  it('nudges the tag down by 3 on the third ignore', () => {
    const profile = {
      picksShown: { milan: { [lm.id]: '2026-09-24' } },
      timesShownNotVisited: { milan: { [lm.id]: 2 } },
      tagScores: { milan: { food: 20 } },
      tagScoresAt: { milan: { food: T0 } },
    };
    const out = settleShownPicks(profile, { today: '2026-09-25', nowMs: T0 });
    expect(out.scorePatches).toEqual([{ region: 'milan', tag: 'food', value: 17, at: T0 }]);
  });
});

describe('time slots', () => {
  it('boosts food at lunch and nightlife on Friday night', () => {
    expect(timeSlotFor(2, 12).boosts).toEqual({ food: 1.3 });
    const fri = timeSlotFor(5, 21);
    expect(fri.weekendNight).toBe(true);
    expect(fri.boosts['local-life']).toBe(1.5);
  });

  it('treats after midnight as the night before', () => {
    expect(timeSlotFor(6, 1).weekendNight).toBe(true);
    expect(timeSlotFor(1, 1).weekendNight).toBe(false);
  });

  it('never boosts a disliked tag', () => {
    expect(applyTimeSlot({ food: 20, 'local-life': -10 }, { food: 1.5, 'local-life': 1.5 })).toEqual({
      food: 30,
      'local-life': -10,
    });
  });
});

describe('globalPopularPicks', () => {
  it('ranks by check-ins across every region, skipping visited and dorms', () => {
    const [a, b, visited] = ALL_LANDMARKS.filter((l) => l.categories[0] === 'food' && l.regionId !== 'miami').slice(0, 3);
    const miamiSpot = ALL_LANDMARKS.find((l) => l.regionId === 'miami' && l.categories[0] === 'history-culture');
    const picks = globalPopularPicks({
      excludeIds: [visited.id],
      checkinCounts: { [a.id]: 5, [miamiSpot.id]: 9, [b.id]: 2, [visited.id]: 50 },
      limit: 10,
    });
    expect(picks.slice(0, 3).map((p) => p.id)).toEqual([miamiSpot.id, a.id, b.id]);
    expect(picks.some((p) => p.id === visited.id)).toBe(false);
    expect(picks.some((p) => ['dorms', 'campus-life'].includes(p.categories[0]))).toBe(false);
    expect(picks).toHaveLength(10);
  });

  it('ranks signup-interest landmarks first, by check-ins across all cities', () => {
    const history = ALL_LANDMARKS.filter((l) => l.categories[0] === 'history-culture');
    const busiestFood = ALL_LANDMARKS.find((l) => l.categories[0] === 'food');
    const busiestHistory = history.at(-1);
    const picks = globalPopularPicks({
      interests: ['history-culture'],
      checkinCounts: { [busiestFood.id]: 99, [busiestHistory.id]: 7 },
      limit: 10,
    });
    expect(picks[0].id).toBe(busiestHistory.id);
    expect(picks.every((p) => p.categories[0] === 'history-culture')).toBe(true);
  });

  it('fills slots the interests cannot with overall popularity', () => {
    const benches = ALL_LANDMARKS.filter((l) => l.categories[0] === 'benches');
    const picks = globalPopularPicks({ interests: ['benches'], limit: 10 });
    expect(picks).toHaveLength(10);
    expect(picks.slice(0, benches.length).every((p) => p.categories[0] === 'benches')).toBe(true);
  });

  it('still fills the row before any check-ins exist', () => {
    expect(globalPopularPicks({ limit: 10 })).toHaveLength(10);
  });
});

describe('swipeShortlist / localSwipePicks (signup swipes + notes only)', () => {
  it('keeps only landmarks whose category was swiped positively', () => {
    const shortlist = swipeShortlist({ region: 'miami', tagDeltas: { food: 20 } });
    expect(shortlist.length).toBeGreaterThan(0);
    for (const l of shortlist) expect(l.categories).toContain('food');
  });

  it('excludes a category with zero or negative swipe signal, even if popular', () => {
    const shortlist = swipeShortlist({ region: 'miami', tagDeltas: { food: 20 } });
    const ids = new Set(shortlist.map((l) => l.id));
    const popularOtherCategory = ALL_LANDMARKS.find(
      (l) => l.regionId === 'miami' && !l.categories?.includes('food') && (l.popularity || 0) >= 9
    );
    expect(popularOtherCategory).toBeTruthy();
    expect(ids.has(popularOtherCategory.id)).toBe(false);
  });

  it('a keyword match pulls in a landmark even with no category signal', () => {
    const target = ALL_LANDMARKS.find((l) => l.regionId === 'miami' && /wynwood/i.test(l.name));
    expect(target).toBeTruthy();
    const withoutKeyword = swipeShortlist({ region: 'miami', tagDeltas: {} });
    expect(withoutKeyword.find((l) => l.id === target.id)).toBeFalsy();
    const withKeyword = swipeShortlist({ region: 'miami', tagDeltas: {}, keywords: ['wynwood'] });
    expect(withKeyword.find((l) => l.id === target.id)).toBeTruthy();
  });

  it('ranks by score, popularity only breaking ties inside the matched set', () => {
    const shortlist = swipeShortlist({ region: 'miami', tagDeltas: { food: 20, 'history-culture': 5 } });
    const scores = shortlist.map((l) => l.tagScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('returns nothing when nothing was loved and no keyword matches', () => {
    expect(swipeShortlist({ region: 'miami', tagDeltas: { food: -15 } })).toEqual([]);
  });

  it('localSwipePicks shapes results like the AI response and scales matchPercentage', () => {
    const picks = localSwipePicks({ region: 'miami', tagDeltas: { food: 20 }, limit: 5 });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(5);
    for (const p of picks) {
      expect(p.matchPercentage).toBeGreaterThanOrEqual(50);
      expect(p.matchPercentage).toBeLessThanOrEqual(97);
      expect(typeof p.oneLineSummary).toBe('string');
    }
  });
});

describe('noteKeywords', () => {
  it('extracts meaningful lowercase words and drops stopwords/short words', () => {
    expect(noteKeywords('Loves: Steak, Sushi. Also said: I really love jazz bars and rooftop views')).toEqual(
      expect.arrayContaining(['steak', 'sushi', 'jazz', 'bars', 'rooftop', 'views'])
    );
    expect(noteKeywords('Loves: Steak, Sushi. Also said: I really love jazz bars and rooftop views')).not.toEqual(
      expect.arrayContaining(['love', 'loves', 'also', 'said', 'with', 'this'])
    );
  });

  it('handles empty input', () => {
    expect(noteKeywords('')).toEqual([]);
    expect(noteKeywords(undefined)).toEqual([]);
  });
});
