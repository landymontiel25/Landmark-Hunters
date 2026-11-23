// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, useState } from 'react';
import MapCategoryBar, { passesMapCategories, zoomTarget, selectAllUsed } from './MapCategoryBar';
import { PICKABLE_INTERESTS } from '../data/regions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let el;
let root;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  el?.remove();
});

function Harness({ onValue }) {
  const [v, setV] = useState(null);
  onValue(v);
  return <MapCategoryBar value={v} onChange={setV} />;
}
async function mount() {
  let value;
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => root.render(<Harness onValue={(v) => (value = v)} />));
  return () => value;
}
const click = (b) => act(async () => b.click());
const chip = (label) => el.querySelector(`.map-cat-chip[aria-label="${label}"]`);
const selectAll = () => [...el.querySelectorAll('.map-cat-chip')].find((b) => b.textContent === 'Select All');

describe('Map category bar', () => {
  it('starts with nothing picked: Select All plus one emoji per category', async () => {
    const value = await mount();
    expect(value()).toBeNull();
    expect(selectAll()).toBeTruthy();
    expect(el.querySelectorAll('.map-cat-chip').length).toBe(PICKABLE_INTERESTS.length + 1);
    expect(el.querySelector('.map-cat-chip.on')).toBeNull();
  });

  it('Select All lights everything; tapping it again clears', async () => {
    const value = await mount();
    await click(selectAll());
    expect(value()).toBe('all');
    expect(el.querySelectorAll('.map-cat-chip.on').length).toBe(PICKABLE_INTERESTS.length + 1);
    await click(selectAll());
    expect(value()).toBeNull();
  });

  it('emojis pick several categories; from Select All an emoji narrows to it', async () => {
    const value = await mount();
    const [a, b] = PICKABLE_INTERESTS;
    await click(chip(a.label));
    await click(chip(b.label));
    expect(value()).toEqual([a.id, b.id]);
    await click(chip(a.label));
    await click(chip(b.label));
    expect(value()).toBeNull();
    await click(selectAll());
    await click(chip(b.label));
    expect(value()).toEqual([b.id]);
  });
});

describe('passesMapCategories', () => {
  const park = { categories: ['parks-nature'] };
  const airport = { categories: ['airports'] };
  it('nothing picked shows nothing; Select All shows everything, hidden kinds too', () => {
    expect(passesMapCategories(null, park)).toBe(false);
    expect(passesMapCategories([], park)).toBe(false);
    expect(passesMapCategories('all', park)).toBe(true);
    expect(passesMapCategories('all', airport)).toBe(true);
  });
  it('a category list shows only those', () => {
    expect(passesMapCategories(['parks-nature'], park)).toBe(true);
    expect(passesMapCategories(['food'], park)).toBe(false);
  });
});

describe('Select All zoom', () => {
  const realAnimate = Element.prototype.animate;
  const realRect = Element.prototype.getBoundingClientRect;
  afterEach(() => {
    Element.prototype.animate = realAnimate;
    Element.prototype.getBoundingClientRect = realRect;
    localStorage.clear();
    document.querySelectorAll('.map-cat-all-zoom').forEach((n) => n.remove());
  });
  const fakeLayout = () => {
    Element.prototype.getBoundingClientRect = () => ({ left: 64, top: 80, width: 96, height: 44, right: 160, bottom: 124 });
    const calls = [];
    Element.prototype.animate = function animate(frames, opts) {
      calls.push({ el: this, frames, opts });
      return { finished: new Promise(() => {}), cancel() {} };
    };
    return calls;
  };
  const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)));

  it('stays inside the screen and grows big', () => {
    const t = zoomTarget({ left: 64, top: 80, width: 96, height: 44 }, 390, 844);
    expect(t.scale).toBeGreaterThanOrEqual(2.5);
    expect(64 + 48 + t.dx - (96 * t.scale) / 2).toBeGreaterThanOrEqual(16);
  });

  it('zooms once when the Map opens with nothing showing, on a copy over the button', async () => {
    const calls = fakeLayout();
    await mount();
    await wait(650);
    expect(calls).toHaveLength(1);
    expect(calls[0].el.classList.contains('map-cat-all-zoom')).toBe(true);
    expect(calls[0].el.getAttribute('aria-hidden')).toBe('true');
    expect(calls[0].frames[1].transform).toMatch(/scale\(/);
  });

  it('after Select All has been used, never zooms again, and the emphasis stops', async () => {
    const calls = fakeLayout();
    await mount();
    await click(selectAll());
    expect(localStorage.getItem('lh.selectAllUsed')).toBe('1');
    expect(el.querySelector('.map-cat-bar').classList.contains('needs-pick')).toBe(false);
    expect(document.querySelector('.map-cat-all-zoom')).toBeNull();
    act(() => root.unmount());
    el.remove();
    calls.length = 0;
    await mount();
    await wait(650);
    expect(calls).toHaveLength(0);
    expect(selectAllUsed()).toBe(true);
  });
});

describe('Select All, loud', () => {
  it('a landmark showing but not tappable: gold callout naming it, cleared by Select All', async () => {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    function Loud() {
      const [v, setV] = useState(null);
      return <MapCategoryBar value={v} onChange={setV} urgent="Abaco Beach Resort" />;
    }
    await act(async () => root.render(<Loud />));
    expect(el.querySelector('.map-cat-bar').classList.contains('needs-pick-loud')).toBe(true);
    expect(el.querySelector('.map-cat-urgent').textContent).toBe('Tap Select All or a category to open Abaco Beach Resort and the places around it.');
    await click(selectAll());
    expect(el.querySelector('.map-cat-urgent')).toBeNull();
  });
});
