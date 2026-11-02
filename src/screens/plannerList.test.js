import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TURNED_OFF, REMOVED } from './plannerList';

// The Planner list must match the code: every switch it names is still
// there and still off. If one is turned back on, take it off the list.
describe('Planner list (Test tab)', () => {
  it.each(TURNED_OFF.map((item) => [item.name, item]))('%s is still off in the code', (_name, item) => {
    expect(readFileSync(item.file, 'utf8')).toContain(item.check);
  });

  it('every entry says what it hides, what stays, when and where', () => {
    for (const item of TURNED_OFF) {
      expect(item.hides && item.keeps && item.since && item.pr).toBeTruthy();
    }
    for (const item of REMOVED) expect(item.what && item.since && item.pr).toBeTruthy();
  });
});
