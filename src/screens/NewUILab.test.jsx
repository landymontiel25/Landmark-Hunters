// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The live Mapr tab has its own tests; a stand-in shows it's the real one.
vi.mock('./Mapr', () => ({ default: () => <p className="live-mapr-stub">live mapr</p> }));
vi.mock('./MapExplore', () => ({ default: () => <p className="live-map-stub">live map</p> }));
vi.mock('../components/Header', () => ({ default: () => <header className="app-header live-header-stub">live header</header> }));
vi.mock('../lib/placePacks', () => ({ ensurePlacePacks: () => Promise.resolve(true), usePlacePacksVersion: () => 0 }));

// Reduce Motion on: every spring lands at once, so the tests don't wait on
// animation (and the reduced-motion path is the one under test).
beforeEach(() => {
  window.matchMedia = (q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} });
});

let container;
afterEach(() => {
  container?.remove();
  document.documentElement.removeAttribute('data-theme');
  document.body.className = '';
  delete document.body.dataset.apple;
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
const tab = (el, name) => [...el.querySelectorAll('.nui-tabbar button')].find((t) => t.textContent.endsWith(name));
const wait = () => act(() => new Promise((r) => setTimeout(r, 0)));
// The screen on top of the tab you're on.
const top = (el) => el.querySelector('[data-active] .nui-scroll[data-top]');

describe('New UI (Test tab)', () => {
  it("has the app's emoji tabs and its real header, opening on Map", async () => {
    const el = await render();
    await wait();
    expect([...el.querySelectorAll('.nui-tabbar button')].map((b) => b.textContent)).toEqual(['\u{1F310}Map', '\u{1F4CD}Landmarks', 'Mapr', '\u{1F5FA}\u{FE0F}Itinerary', '\u{1F3C6}Profile']);
    expect(el.querySelector('.nui-apphead .live-header-stub')).toBeTruthy();
    // Mapr's tab is the logo in a squircle with a sparkle, no brain (owner, 2026-11-14).
    expect(el.querySelector('.nui-tabbar .mapr-tab-icon img').getAttribute('src')).toBe('/logo.png');
    expect(el.querySelector('.nui-tabbar').textContent).not.toContain('\u{1F9E0}');
    expect(tab(el, 'Map').getAttribute('aria-current')).toBe('page');
    // Map is the live map, in its own look (body[data-apple='map']).
    const map = el.querySelector('.live-map-stub');
    expect(map).toBeTruthy();
    expect(map.closest('.nui')).toBeNull();
    expect(document.body.dataset.apple).toBe('map');
    await click(tab(el, 'Landmarks'));
    expect(document.body.dataset.apple).toBeUndefined();
  });

  it('every tab opens its own full screen; Mapr is the live Mapr tab, outside the new styles', async () => {
    const el = await render();
    await click(tab(el, 'Landmarks'));
    expect(top(el).querySelector('.nui-title').textContent).toBe('Landmarks');
    expect(top(el).querySelectorAll('.nui-row').length).toBeGreaterThan(5);
    await click(tab(el, 'Itinerary'));
    expect(top(el).querySelector('.nui-title').textContent).toBe('Itinerary');
    expect(top(el).querySelectorAll('.nui-trip')).toHaveLength(2);
    await click(tab(el, 'Profile'));
    expect(top(el).querySelector('.nui-stats').textContent).toContain('Check-ins');
    // Only the tab you're on shows.
    expect(el.querySelectorAll('.nui-tabview:not([hidden])')).toHaveLength(1);
    await click(tab(el, 'Mapr'));
    await wait();
    const stub = el.querySelector('.live-mapr-stub');
    expect(stub).toBeTruthy();
    expect(stub.closest('.nui')).toBeNull();
    expect(el.querySelectorAll('.nui-tabview:not([hidden])')).toHaveLength(0);
  });

  it('a place pushes in from Landmarks with no rating or price, and Back pops it', async () => {
    const el = await render();
    await click(tab(el, 'Landmarks'));
    const name = top(el).querySelector('.nui-row .nui-row-title').textContent;
    await click(top(el).querySelector('.nui-row'));
    expect(top(el).querySelector('.nui-hero-title').textContent).toBe(name);
    expect(top(el).textContent).not.toMatch(/★|\$/);
    for (const a of top(el).querySelectorAll('.nui-source')) expect(a.getAttribute('href')).toMatch(/^https?:\/\//);
    // The screen underneath is out of reach while covered.
    expect(el.querySelector('[data-active] .nui-layer').hasAttribute('inert')).toBe(true);
    const back = top(el).querySelector('.nui-hero-back');
    expect(back.getAttribute('aria-label')).toBe('Back to Landmarks');
    await click(back);
    expect(top(el).querySelector('.nui-title').textContent).toBe('Landmarks');
    expect(el.querySelectorAll('[data-active] .nui-layer')).toHaveLength(1);
  });

  it('each tab keeps its own stack; tapping the current tab goes back to its top', async () => {
    const el = await render();
    await click(tab(el, 'Itinerary'));
    await click(top(el).querySelector('.nui-trip'));
    expect(top(el).querySelector('.nui-backbar').textContent).toBe('Itinerary');
    await click(top(el).querySelector('.nui-row'));
    expect(top(el).querySelector('.nui-hero')).toBeTruthy();
    expect(top(el).querySelector('.nui-hero-back').getAttribute('aria-label')).toMatch(/^Back to /);
    // Away and back: still where you were.
    await click(tab(el, 'Profile'));
    await click(tab(el, 'Itinerary'));
    expect(top(el).querySelector('.nui-hero')).toBeTruthy();
    await click(tab(el, 'Itinerary'));
    expect(top(el).querySelector('.nui-title').textContent).toBe('Itinerary');
  });

  it('search filters as you type and says so when nothing matches', async () => {
    const el = await render();
    await click(tab(el, 'Landmarks'));
    const input = top(el).querySelector('.nui-search input');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const type = (v) =>
      act(async () => {
        setValue.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const first = top(el).querySelector('.nui-row .nui-row-title').textContent;
    await type(first.slice(0, 5));
    const names = [...top(el).querySelectorAll('.nui-row .nui-row-title')].map((n) => n.textContent.toLowerCase());
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toContain(first.slice(0, 5).toLowerCase());
    await type('zzzzqqq');
    expect(top(el).querySelector('.nui-empty').textContent).toContain('No places match');
    await click(top(el).querySelector('[aria-label="Clear search"]'));
    expect(input.value).toBe('');
  });

  it('the sort control is one choice of three', async () => {
    const el = await render();
    await click(tab(el, 'Landmarks'));
    const seg = top(el).querySelector('.nui-seg[aria-label="Sort"]');
    const radios = [...seg.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual(['For you', 'Nearby', 'A–Z']);
    await click(radios[2]);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    const names = [...top(el).querySelectorAll('.nui-row .nui-row-title')].map((n) => n.textContent);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('Plan a trip opens a sheet over the tab bar, with Cancel and Escape to close', async () => {
    const el = await render();
    await click(tab(el, 'Itinerary'));
    await click([...top(el).querySelectorAll('.nui-btn-primary')].find((b) => b.textContent === 'Plan a trip'));
    const sheet = el.querySelector('.nui-sheet[role="dialog"]');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.querySelector('#nui-sheet-title').textContent).toBe('New trip');
    expect(document.activeElement).toBe(sheet);
    await click([...sheet.querySelectorAll('button')].find((b) => b.textContent === 'Cancel'));
    expect(el.querySelector('.nui-sheet')).toBeNull();
    await click([...top(el).querySelectorAll('.nui-btn-primary')].find((b) => b.textContent === 'Plan a trip'));
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(el.querySelector('.nui-sheet')).toBeNull();
  });

  it('Profile rows open their own screen with a way back', async () => {
    const el = await render();
    await click(tab(el, 'Profile'));
    await click([...top(el).querySelectorAll('.nui-row')].find((r) => r.textContent === 'Settings'));
    expect(top(el).querySelector('.nui-title').textContent).toBe('Settings');
    await click(top(el).querySelector('.nui-backbar'));
    expect(top(el).querySelector('.nui-stats')).toBeTruthy();
  });

  it('follows the app theme, switches light and dark, full screen, and saves nothing', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const el = await render();
    expect(el.querySelector('.nui-tabbar').dataset.mode).toBe('dark');
    await click(el.querySelector('[aria-label="Show light mode"]'));
    expect(el.querySelector('.nui-tabbar').dataset.mode).toBe('light');
    // The live header and Mapr read the page theme, so it follows the preview.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await click(el.querySelector('[aria-label="Full screen"]'));
    expect(document.body.classList.contains('ui-lab-full')).toBe(true);
    await click(el.querySelector('[aria-label="Exit full screen"]'));
    expect(document.body.classList.contains('ui-lab-full')).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('gives the page its own theme back when you leave', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { default: NewUILab } = await import('./NewUILab.jsx');
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<NewUILab />));
    await click(container.querySelector('[aria-label="Show light mode"]'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await act(async () => root.unmount());
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
