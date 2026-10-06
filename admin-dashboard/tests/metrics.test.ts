import { describe, it, expect } from 'vitest';
import { accuracyRows, bytes, deviationAlerts, goalCardClass, num, pct, toCsv, trendOf } from '@/lib/metrics';

describe('formatting', () => {
  it('pct, num, bytes', () => {
    expect(pct(0.1234)).toBe('12.3%');
    expect(pct(null)).toBe('—');
    expect(num(3.14159, 2)).toBe('3.14');
    expect(num(undefined)).toBe('—');
    expect(bytes(512)).toBe('512 B');
    expect(bytes(2048)).toBe('2.0 KB');
  });
});

describe('trendOf', () => {
  it('compares the last value with the one before', () => {
    expect(trendOf([{ v: 10 }, { v: 12 }], 'v')).toEqual({ value: 20, direction: 'up' });
    expect(trendOf([{ v: 10 }, { v: null }, { v: 5 }], 'v')).toEqual({ value: -50, direction: 'down' });
    expect(trendOf([{ v: 1 }], 'v')).toBeUndefined();
    expect(trendOf([{ v: 0 }, { v: 3 }], 'v')).toBeUndefined();
  });
});

describe('deviationAlerts (>20% from the 7-day average)', () => {
  const rows = (last: number) => [...Array(7).fill(0.5).map((v) => ({ m: v })), { m: last }];
  it('fires above and below, not inside the band', () => {
    expect(deviationAlerts(rows(0.7), [{ key: 'm', label: 'Match rate' }])[0]).toMatch(/40% above/);
    expect(deviationAlerts(rows(0.3), [{ key: 'm', label: 'Match rate' }])[0]).toMatch(/40% below/);
    expect(deviationAlerts(rows(0.55), [{ key: 'm', label: 'Match rate' }])).toEqual([]);
  });
  it('needs at least two earlier values', () => {
    expect(deviationAlerts([{ m: 1 }, { m: 5 }], [{ key: 'm', label: 'x' }])).toEqual([]);
  });
});

it('toCsv quotes commas, quotes and newlines', () => {
  expect(toCsv([{ a: 'x,y', b: 'say "hi"' }, { a: null, b: 2 }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }])).toBe('A,B\n"x,y","say ""hi"""\n,2');
});

it('accuracyRows sorts by match rate, unmeasured last', () => {
  const rows = accuracyRows({ food: { match_rate: 0.5, skip_rate: 0, repeat_rate: 0, sample_size: 4 }, art: { match_rate: 0.9, skip_rate: 0, repeat_rate: 0, sample_size: 2 }, none: { match_rate: null, skip_rate: 1, repeat_rate: 0, sample_size: 1 } });
  expect(rows.map((r) => r.name)).toEqual(['art', 'food', 'none']);
});

describe('goal card tint', () => {
  it('green when met, red when missed, plain otherwise', () => {
    expect(goalCardClass('met')).toBe('card card-met');
    expect(goalCardClass('missed')).toBe('card card-missed');
    expect(goalCardClass('unknown')).toBe('card');
    expect(goalCardClass('info')).toBe('card');
    expect(goalCardClass(undefined)).toBe('card');
  });
});
