// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import PlannerLab from './PlannerLab';
import { TURNED_OFF } from './plannerList';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('PlannerLab (Test tab: Planner)', () => {
  it('lists every turned-off feature, then what was taken out', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => createRoot(el).render(<PlannerLab />));
    const names = [...el.querySelectorAll('.planner-item strong')].map((n) => n.textContent);
    expect(names.slice(0, TURNED_OFF.length)).toEqual(TURNED_OFF.map((i) => i.name));
    expect(names).toContain('Badges');
    expect(names.at(-1)).toBe('Travel Picks');
    expect(el.textContent).toContain('Taken out (not a switch)');
    el.remove();
  });
});
