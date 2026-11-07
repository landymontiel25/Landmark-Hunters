// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, useState } from 'react';
import MapCategoryBar, { passesMapCategories } from './MapCategoryBar';
import { PICKABLE_INTERESTS } from '../data/regions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let el;
afterEach(() => el?.remove());

function Harness({ onValue }) {
  const [v, setV] = useState(null);
  onValue(v);
  return <MapCategoryBar value={v} onChange={setV} />;
}
async function mount() {
  let value;
  el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(<Harness onValue={(v) => (value = v)} />));
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
