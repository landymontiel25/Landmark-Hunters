// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The live Mapr tab has its own tests; a stand-in shows it's the real one.
vi.mock('./Mapr', () => ({ default: () => <p className="live-mapr-stub">live mapr</p> }));
vi.mock('../lib/placePacks', () => ({ ensurePlacePacks: () => Promise.resolve(true), usePlacePacksVersion: () => 0 }));

let container;
afterEach(() => {
  container?.remove();
  document.documentElement.removeAttribute('data-theme');
  document.body.className = '';
  localStorage.clear();
});

async function render() {
  const { default: NewUILab } = await import('./NewUILab.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<NewUILab />));
  return container;
}

const click = (el) => act(async () => el.click());
const tab = (el, name) => [...el.querySelectorAll('.nui-tabbar button')].find((t) => t.textContent === name);
const wait = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe('New UI (Test tab)', () => {
  it('has the full tab bar with all 5 tabs, opening on Map', async () => {
    const el = await render();
    expect([...el.querySelectorAll('.nui-tabbar button')].map((b) => b.textContent)).toEqual(['Map', 'Landmarks', 'Mapr', 'Itinerary', 'Profile']);
    expect(tab(el, 'Map').getAttribute('aria-current')).toBe('page');
    expect(el.querySelector('.nui-map')).toBeTruthy();
    expect(el.querySelectorAll('.nui-sheet .nui-card')).toHaveLength(3);
  });

  it('every tab opens its own screen; Mapr is the live Mapr tab, outside the new styles', async () => {
    const el = await render();
    await click(tab(el, 'Landmarks'));
    expect(el.querySelector('.nui-title').textContent).toBe('Landmarks');
    expect(el.querySelectorAll('.nui-list-row').length).toBeGreaterThan(5);
    await click(tab(el, 'Itinerary'));
    expect(el.querySelector('.nui-title').textContent).toBe('Itinerary');
    expect(el.querySelectorAll('.nui-trip')).toHaveLength(2);
    await click(tab(el, 'Profile'));
    expect(el.querySelector('.nui-stats').textContent).toContain('Check-ins');
    await click(tab(el, 'Mapr'));
    await wait();
    const stub = el.querySelector('.live-mapr-stub');
    expect(stub).toBeTruthy();
    expect(stub.closest('.nui')).toBeNull();
  });

  it('a place opens from Landmarks with no rating or price, and goes back', async () => {
    const el = await render();
    await click(tab(el, 'Landmarks'));
    const name = el.querySelector('.nui-list-row .nui-row-title').textContent;
    await click(el.querySelector('.nui-list-row'));
    expect(el.querySelector('.nui-hero-title').textContent).toBe(name);
    expect(el.querySelector('.nui-scroll').textContent).not.toMatch(/★|\$/);
    for (const a of el.querySelectorAll('.nui-source')) expect(a.getAttribute('href')).toMatch(/^https?:\/\//);
    await click(el.querySelector('.nui-hero-back'));
    expect(el.querySelector('.nui-title').textContent).toBe('Landmarks');
  });

  it('follows the app theme, switches light and dark, full screen, and saves nothing', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const el = await render();
    expect(el.querySelector('.nui-tabbar').dataset.mode).toBe('dark');
    await click(el.querySelector('[aria-label="Show light mode"]'));
    expect(el.querySelector('.nui-tabbar').dataset.mode).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await click(el.querySelector('[aria-label="Full screen"]'));
    expect(document.body.classList.contains('ui-lab-full')).toBe(true);
    await click(el.querySelector('[aria-label="Exit full screen"]'));
    expect(document.body.classList.contains('ui-lab-full')).toBe(false);
    expect(localStorage.length).toBe(0);
  });
});
