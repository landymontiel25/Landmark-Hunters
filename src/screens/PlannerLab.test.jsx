// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
// The real landmark list is tested in LandmarkSelection.cards.test.jsx.
vi.mock('./LandmarkSelection', () => ({
  default: ({ forMeLab }) => <div className="for-me-stub">{forMeLab ? 'For Me list' : 'Landmarks list'}</div>,
}));
import PlannerLab from './PlannerLab';
import { TURNED_OFF } from './plannerList';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('PlannerLab (Test tab: Planner launch)', () => {
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

  it('For Me still renders here, under a For Me heading, as the For Me list', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => createRoot(el).render(<PlannerLab />));
    expect(el.querySelector('.screen-title').textContent).toContain('Planner launch');
    const section = el.querySelector('section[aria-label="For Me"]');
    expect(section.querySelector('h2').textContent).toBe('For Me');
    expect(section.querySelector('.for-me-stub').textContent).toBe('For Me list');
    expect([...el.querySelectorAll('.planner-item strong')].map((n) => n.textContent)).toContain('For Me sort (Landmarks tab)');
    el.remove();
  });
});
