import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/AuthContext', () => ({ useAuth: () => ({}) }));
const { sheetDistance } = await import('./useMapPicks');

describe('sheetDistance (owner, 2026-11-08: the Map radius sets the sheet too)', () => {
  it('uses the Map radius menu over any chip or default', () => {
    expect(sheetDistance({ mapDistance: 50, chosen: 5, auto: 10 })).toBe(50);
    expect(sheetDistance({ mapDistance: 1, chosen: 25, showRefresh: true, auto: 10 })).toBe(1);
  });
  it('without the menu, keeps the old order: tapped chip, Test default, smart default', () => {
    expect(sheetDistance({ chosen: 5, auto: 10 })).toBe(5);
    expect(sheetDistance({ showRefresh: true, auto: 10 })).toBe(5);
    expect(sheetDistance({ auto: 10 })).toBe(10);
  });
});
