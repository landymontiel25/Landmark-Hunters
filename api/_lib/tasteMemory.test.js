import { describe, it, expect } from 'vitest';
import { buildTasteMemory, tasteMemoryText } from './tasteMemory.js';
import { kindAffinity, placeTasteWeight } from '../../src/lib/placeKinds.js';
import { chatRanking } from './maprChatRanking.js';

const P = {
  'pizza-1': { id: 'pizza-1', regionId: 'abacos', name: 'Harbour Pizza', categories: ['food'], summary: 'Wood-fired pizza by the dock.', lat: 26.54, lng: -76.96 },
  'pizza-2': { id: 'pizza-2', regionId: 'abacos', name: 'Island Pie Co', categories: ['food'], summary: 'Thin-crust pizza and slices.', lat: 26.541, lng: -76.961 },
  'pizza-3': { id: 'pizza-3', regionId: 'abacos', name: 'Cay Pizzeria', categories: ['food'], summary: 'Pizzeria with conch pizza.', lat: 26.542, lng: -76.962 },
  'sushi-1': { id: 'sushi-1', regionId: 'abacos', name: 'Reef Sushi', categories: ['food'], summary: 'Sushi and sashimi bar.', lat: 26.543, lng: -76.963 },
  'sushi-2': { id: 'sushi-2', regionId: 'abacos', name: 'Omakase Cay', categories: ['food'], summary: 'Omakase sushi counter.', lat: 26.544, lng: -76.964 },
};
const findPlace = (r) => P[r.landmarkId] || null;
const rating = (id, ratingTier, wouldReturn = null) => ({ landmarkId: id, region: 'abacos', landmarkName: P[id].name, ratingTier, wouldReturn, categories: ['food'] });

describe("Mapr's taste memory (owner, 2026-11-24)", () => {
  it('"Would you come back?" counts as much as the rating, and repeat visits add up', () => {
    expect(placeTasteWeight({ ratingTier: 'worth-trying' })).toBe(1);
    expect(placeTasteWeight({ ratingTier: 'worth-trying', wouldReturn: 'yes' })).toBe(4);
    expect(placeTasteWeight({ ratingTier: 'highly-recommend', wouldReturn: 'never-again' })).toBe(-1);
    expect(placeTasteWeight({ ratingTier: 'highly-recommend', wouldReturn: 'yes', visits: 4 })).toBe(9);
    // A place they disliked doesn't turn positive just because they went often.
    expect(placeTasteWeight({ ratingTier: 'probably-skip', visits: 5 })).toBe(-3);
  });

  it('a pizza lover: pizza leads what Mapr knows, sushi is avoided', () => {
    const m = buildTasteMemory({
      reviews: [rating('pizza-1', 'highly-recommend', 'yes'), rating('pizza-2', 'highly-recommend', 'yes'), rating('sushi-1', 'probably-skip', 'never-again')],
      checkins: [1, 2, 3].map((i) => ({ landmarkId: 'pizza-1', region: 'abacos', landmarkName: 'Harbour Pizza', createdAtMs: i })),
      findPlace,
    });
    expect(m.loves[0]).toMatchObject({ kind: 'pizza' });
    expect(m.loves[0].places[0]).toBe('Harbour Pizza');
    expect(m.avoids.map((e) => e.kind)).toContain('sushi');
    expect(m.goBack).toEqual(expect.arrayContaining(['Harbour Pizza', 'Island Pie Co']));
    expect(m.regulars).toEqual([{ name: 'Harbour Pizza', visits: 3 }]);
    const text = tasteMemoryText(m);
    expect(text).toMatch(/Kinds of place they love: pizza \(\+\d+: Harbour Pizza, Island Pie Co\)/);
    expect(text).toMatch(/Kinds they avoid: sushi/);
    expect(text).toMatch(/Keeps going back to: Harbour Pizza \(3 visits\)/);
    expect(text).toMatch(/lead with the kinds they love/);
  });

  it('nothing yet: no memory block', () => {
    expect(tasteMemoryText(buildTasteMemory({ reviews: [], checkins: [] }))).toBe('');
  });

  it('taste changes the picks: after rating pizza up and sushi down, pizza places rank first', () => {
    const pool = [P['sushi-2'], P['pizza-3'], P['sushi-1'], P['pizza-2']];
    const before = chatRanking({ uid: 'u', pool, curated: pool, regionsChosen: true, reviews: [], count: 4, rng: () => 0.5 });
    const m = buildTasteMemory({ reviews: [rating('pizza-1', 'highly-recommend', 'yes'), rating('sushi-1', 'probably-skip', 'never-again')], findPlace });
    const affinity = kindAffinity(Object.fromEntries(m.reviews.map((r) => [r.landmarkId, { ...r, ratingTier: r.tier }])), findPlace);
    expect(affinity.pizza).toBeGreaterThan(0);
    expect(affinity.sushi).toBeLessThan(0);
    const after = chatRanking({ uid: 'u', pool, curated: pool, regionsChosen: true, reviews: m.reviews.map((r) => ({ ...r })), count: 4, rng: () => 0.5 });
    const firstKind = (rk) => [...rk.text.matchAll(/^abacos\/(\S+)/gm)].map((x) => x[1])[0];
    expect(firstKind(after)).toMatch(/^pizza/);
    expect(before).toBeTruthy();
  });
});
