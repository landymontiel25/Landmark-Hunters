// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let answer;
vi.mock('../lib/travelDistances', () => ({ cardTravelMode: async () => 'car', travelDistance: () => answer }));
vi.mock('../lib/UnitsContext', async (orig) => ({ ...(await orig()), useUnits: () => ({ units: 'metric' }) }));
const { default: TravelDistance } = await import('./TravelDistance.jsx');

const here = { lat: 25.7743, lng: -80.1937 };
const place = { lat: 25.7674, lng: -80.1929 }; // ~0.8 km straight
async function render() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(<TravelDistance place={place} origin={here} suffix=" away" />));
  return el;
}
afterEach(() => (document.body.innerHTML = ''));

describe('a card shows the route distance (owner, 2026-11-23)', () => {
  it('the route, never the straight line, when a route exists', async () => {
    answer = Promise.resolve({ meters: 1396, seconds: 417 });
    const el = await render();
    expect(el.textContent).toBe('1.4 km away');
  });
  it('nothing while the route is looked up', async () => {
    answer = new Promise(() => {});
    expect((await render()).textContent).toBe('');
  });
  it('the straight line only when there is no route at all', async () => {
    answer = Promise.resolve(null);
    expect((await render()).textContent).toBe('771 m away');
  });
});
