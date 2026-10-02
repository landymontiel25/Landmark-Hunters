import { describe, it, expect, vi } from 'vitest';
import { storedSeries } from './statsSummary.js';

describe('storedSeries', () => {
  it('orders by the date field, which Firestore indexes by default (descending __name__ needs a manual index and failed in production)', async () => {
    const orderBy = vi.fn(() => ({ limit: () => ({ get: async () => ({ docs: [{ data: () => ({ daily: { date: '2026-01-02' } }) }] }) }) }));
    const db = { collection: () => ({ orderBy }) };
    const out = await storedSeries(db);
    expect(orderBy).toHaveBeenCalledWith('date', 'desc');
    expect(out.days).toBe(1);
  });
});
