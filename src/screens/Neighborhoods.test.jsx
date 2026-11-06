// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import DATA from '../data/miamiNeighborhoods.json';
import { NeighborhoodsView, NeighborhoodDetail } from './Neighborhoods';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let el;
afterEach(() => el?.remove());

async function mount(node) {
  el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(node));
  return el;
}
const click = (node) => act(async () => node.click());
const byText = (sel, text) => [...el.querySelectorAll(sel)].find((b) => b.textContent.trim() === text);
const cardNames = () => [...el.querySelectorAll('.nb-card-name')].map((n) => n.textContent);
async function type(input, value) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const ratings = (o = {}) => ({
  safety: null,
  walkability: null,
  restaurants: { quantity: null, price: null, diversity: null },
  nightlife: null,
  averagePropertyPrice: null,
  artAndCulture: null,
  shopping: null,
  ...o,
});

describe('Neighborhoods subtab', () => {
  it('shows the header, search, Popular by default and the four featured cards in order', async () => {
    await mount(<NeighborhoodsView data={DATA} />);
    expect(el.querySelector('.nb-eyebrow').textContent).toBe('LANDMARK HUNTERS · MIAMI');
    expect(el.querySelector('.nb-title').textContent).toBe('Explore Neighborhoods');
    expect(el.querySelector('input[type="search"]').placeholder).toBe('Search Miami neighborhoods...');
    expect(byText('.nb-tab', 'Popular').getAttribute('aria-selected')).toBe('true');
    expect(byText('.nb-chip', 'Must-See').getAttribute('aria-pressed')).toBe('true');
    expect(cardNames()).toEqual(['South Beach', 'Wynwood', 'Downtown Miami', 'Little Havana']);
    expect(el.querySelector('.nb-explore').textContent).toBe('Explore: Must-See');
    expect(el.querySelector('[data-testid="nb-explore-list"]').textContent).toBe('4 neighborhoods · South Beach, Wynwood, Downtown Miami, Little Havana');
  });

  it('with every rating null, every card shows "–"', async () => {
    await mount(<NeighborhoodsView data={DATA} />);
    await click(byText('.nb-tab', 'All areas'));
    await click(byText('.nb-chip', 'Tier 1'));
    const badges = [...el.querySelectorAll('.nb-score-badge')];
    expect(badges.length).toBe(10);
    for (const b of badges) expect(b.textContent).toBe('–');
  });

  it('All areas lists every neighborhood under city headers, in file order', async () => {
    const data = { ...DATA, featured: DATA.neighborhoods.map((n) => n.name) }; // Must-See = all
    await mount(<NeighborhoodsView data={data} />);
    await click(byText('.nb-tab', 'All areas'));
    expect([...el.querySelectorAll('.nb-group .nb-section')].map((h) => h.textContent)).toEqual([...new Set(DATA.neighborhoods.map((n) => n.cityGroup))]);
    expect(cardNames()).toEqual(DATA.neighborhoods.map((n) => n.name));
  });

  it('a chip with no neighborhoods says so', async () => {
    await mount(<NeighborhoodsView data={DATA} />);
    await click(byText('.nb-chip', 'Hidden Gems'));
    expect(el.textContent).toContain('Explore: Hidden Gems');
    expect(el.textContent).toContain('No neighborhoods here yet.');
    expect(el.querySelectorAll('.nb-card').length).toBe(0);
  });

  it('the Explore count always matches the cards shown', async () => {
    await mount(<NeighborhoodsView data={DATA} />);
    await click(byText('.nb-tab', 'All areas'));
    for (const chip of ['Must-See', 'Tier 1', 'Tier 2', 'Tier 3']) {
      await click(byText('.nb-chip', chip));
      const n = el.querySelectorAll('.nb-card').length;
      expect(el.querySelector('[data-testid="nb-explore-list"]').textContent).toMatch(new RegExp(`^${n} neighborhoods · `));
    }
  });

  it('search filters by name, ignoring case, and says when nothing matches', async () => {
    await mount(<NeighborhoodsView data={DATA} />);
    const input = el.querySelector('input[type="search"]');
    await type(input, 'wYnW');
    expect(cardNames()).toEqual(['Wynwood']);
    await type(input, 'nowhere');
    expect(el.textContent).toContain('No neighborhoods match your search.');
  });

  it('Nearby without a location asks for it, and only on a tap', async () => {
    const onUseLocation = vi.fn();
    await mount(<NeighborhoodsView data={DATA} onUseLocation={onUseLocation} />);
    await click(byText('.nb-tab', 'Nearby'));
    expect(el.textContent).toContain('Turn on location to see neighborhoods near you.');
    expect(onUseLocation).not.toHaveBeenCalled();
    await click(byText('button', 'Use my location'));
    expect(onUseLocation).toHaveBeenCalledTimes(1);
  });

  it('Nearby with a location lists closest first', async () => {
    const data = { ...DATA, featured: DATA.neighborhoods.map((n) => n.name) };
    await mount(<NeighborhoodsView data={data} coords={{ lat: 25.7743, lng: -80.1337 }} />);
    await click(byText('.nb-tab', 'Nearby'));
    expect(cardNames()[0]).toBe('South Beach');
  });

  it('a card with no photo shows its first letter on a dark tile', async () => {
    const data = { city: 'Miami', featured: ['Zed'], tiers: [], neighborhoods: [{ name: 'Zed', cityGroup: 'X', info: '', photo: '', tags: ['Beaches', 'Art Deco'], ratings: ratings({ safety: 4.5 }) }] };
    await mount(<NeighborhoodsView data={data} />);
    expect(el.querySelector('[data-testid="nb-placeholder"]').textContent).toBe('Z');
    expect(el.querySelector('.nb-card-sub').textContent).toBe('Beaches · Art Deco');
    expect(el.querySelector('.nb-score-badge').textContent).toBe('4.5');
    expect(el.querySelector('.nb-score-badge').classList.contains('band-green')).toBe(true);
  });
});

describe('Neighborhood detail', () => {
  const base = { name: 'Brickell', cityGroup: 'City of Miami', photo: '', tags: [], photoCredit: null };

  it('shows name and score, no info when empty, then seven sliders, and no landmark or check-in parts', async () => {
    await mount(<NeighborhoodDetail n={{ ...base, info: '', ratings: ratings() }} onBack={() => {}} />);
    expect(el.querySelector('.nb-detail-title').textContent).toBe('Brickell –');
    expect(el.querySelector('.nb-detail-info')).toBeNull();
    const labels = [...el.querySelectorAll('.nb-slider-label')].map((l) => l.textContent);
    expect(labels).toEqual(['Safety', 'Walkability', 'Restaurants', 'Nightlife', 'Average Property Price', 'Art and Culture', 'Shopping']);
    for (const v of el.querySelectorAll('.nb-slider-value')) expect(v.textContent).toBe('–');
    expect(el.querySelectorAll('[data-testid="nb-fill"]').length).toBe(0);
    expect(el.textContent).not.toMatch(/check.?in/i);
    expect(el.textContent).not.toMatch(/landmark/i);
    expect(el.querySelector('.landmark-row, .check-circle')).toBeNull();
    expect(byText('button', '‹ Back')).toBeTruthy();
  });

  it('shows info when there is some, above the sliders', async () => {
    await mount(<NeighborhoodDetail n={{ ...base, info: 'Financial district.', ratings: ratings() }} onBack={() => {}} />);
    const info = el.querySelector('.nb-detail-info');
    expect(info.textContent).toBe('Financial district.');
    expect(info.compareDocumentPosition(el.querySelector('.nb-sliders')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('scores: one decimal, filled to the score in its band color', async () => {
    const r = ratings({ safety: 1, walkability: 3, restaurants: { quantity: 4, price: 2, diversity: 5 }, nightlife: 2, averagePropertyPrice: 4, artAndCulture: 3, shopping: 5 });
    await mount(<NeighborhoodDetail n={{ ...base, info: '', ratings: r }} onBack={() => {}} />);
    // 1, 3, 4.5, 2, 4, 3, 5 -> 22.5 / 7 = 3.2
    expect(el.querySelector('.nb-detail-title').textContent).toBe('Brickell 3.2');
    const fills = [...el.querySelectorAll('[data-testid="nb-fill"]')];
    expect(fills[0].className).toContain('band-red');
    expect(fills[0].style.width).toBe('20%');
    expect(fills[1].className).toContain('band-yellow');
    expect(fills[2].className).toContain('band-green');
    expect(el.querySelectorAll('.nb-slider-value')[2].textContent).toBe('4.5');
  });

  it('Restaurants opens Quantity, Price (Coming soon) and Diversity', async () => {
    await mount(<NeighborhoodDetail n={{ ...base, info: '', ratings: ratings() }} onBack={() => {}} />);
    await click(el.querySelector('.nb-expand'));
    const sub = [...el.querySelectorAll('.nb-sub-sliders .nb-slider')];
    expect(sub.map((s) => s.querySelector('.nb-slider-label').textContent)).toEqual(['Quantity', 'Price', 'Diversity']);
    expect(sub[1].querySelector('.nb-slider-value').textContent).toBe('Coming soon');
  });

  it('a card opens its detail and Back returns to the list', async () => {
    await mount(<NeighborhoodsView data={DATA} />);
    await click(el.querySelector('.nb-card'));
    expect(el.querySelector('.nb-detail-title').textContent).toContain('South Beach');
    await click(byText('button', '‹ Back'));
    expect(el.querySelector('.nb-title').textContent).toBe('Explore Neighborhoods');
  });
});
