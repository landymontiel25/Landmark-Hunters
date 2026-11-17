import { describe, expect, it } from 'vitest';
import { ABACOS_LANDMARKS } from './landmarks.abacos.js';
import { getRegion, getLandmark, PICKABLE_REGIONS } from './regions';
import { regionTimezone } from '../lib/timezones';
import { REGION_AREAS } from './cityAreas';
import { CITIES } from '../screens/officialOnboardingSteps';
import { IMAGE_CREDITS } from './imageCredits';

// The owner's 30 Abacos places (2026-11-16), in the owner's order.
const NAMES = [
  'Elbow Reef Lighthouse', "Hope Town's village streets", 'Hope Town Harbour', 'Wyannie Malone Historical Museum',
  'Byrle Patterson Memorial Garden', 'Tahiti Beach', 'Hope Town Inn & Marina', 'Abaco Inn', 'Firefly Sunset Resort',
  'Man-O-War settlement', 'Man-O-War waterfront', "Albury's Sail Shop", "Joe's Studio", "Albury Brothers' boatbuilding heritage",
  'Great Guana Cay Atlantic beach', 'Great Guana Cay settlement', 'Nippers', 'Grabbers', 'New Plymouth', 'Albert Lowe Museum',
  'Loyalist Memorial Sculpture Garden', 'Gillam Bay', 'Coco Bay', 'Green Turtle Club', 'Bluff House',
  'Tranquil Turtle Beach Bar & Restaurant', 'Fowl Cays National Park', 'Sandy Cay reef', 'Manjack Cay', 'Powell Cay',
];
const TRIVIA = new Set(['elbow-reef-lighthouse', 'byrle-patterson-memorial-garden', 'albury-brothers-boatbuilding', 'loyalist-memorial-sculpture-garden']);

describe('the Abacos', () => {
  it('lists all 30 places, in order', () => {
    expect(ABACOS_LANDMARKS.map((l) => l.name)).toEqual(NAMES);
  });

  it('is a city like the others: picker, onboarding, time zone, map area', () => {
    const r = getRegion('abacos');
    expect(r.country).toBe('Bahamas');
    expect(PICKABLE_REGIONS.some((p) => p.id === 'abacos')).toBe(true);
    expect(CITIES.find((c) => c.id === 'abacos')?.regions).toEqual(['abacos']);
    expect(regionTimezone('abacos')).toBe('America/Nassau');
    expect(REGION_AREAS.abacos).toBeTruthy();
    expect(getLandmark('abacos', 'nippers')?.name).toBe('Nippers');
  });

  it('shows the "What it is" line as the description', () => {
    for (const l of ABACOS_LANDMARKS) {
      expect(l.summary).toBe(l.whatItIs);
      expect(l.summary).toMatch(/\.$/);
    }
  });

  it('gives every place 3 facts, each with its source', () => {
    for (const l of ABACOS_LANDMARKS) {
      expect(l.facts).toHaveLength(3);
      for (const f of l.facts) expect(l.factSources[f]).toMatch(/^https?:\/\//);
    }
  });

  it('never uses an em dash, and never links the hacked Grabbers site', () => {
    const text = JSON.stringify(ABACOS_LANDMARKS);
    expect(text).not.toMatch(/—/);
    expect(text).not.toMatch(/grabbersatsunset/);
  });

  it('gives every place a mission: four-option trivia for the questions, a photo for the rest', () => {
    for (const l of ABACOS_LANDMARKS) {
      expect(l.mission?.text).toBeTruthy();
      if (TRIVIA.has(l.id)) {
        expect(l.mission.type).toBe('trivia');
        expect(l.mission.options).toHaveLength(4);
        expect(new Set(l.mission.options).size).toBe(4);
        expect(Number.isInteger(l.mission.answer) && l.mission.answer >= 0 && l.mission.answer < 4).toBe(true);
        expect(l.mission.source).toMatch(/^https:\/\//);
      } else {
        expect(l.mission.type).toBe('photo');
      }
    }
  });

  it('credits every stored photo', () => {
    for (const l of ABACOS_LANDMARKS) for (const src of l.images) expect(IMAGE_CREDITS[src]?.license).toBeTruthy();
  });
});
