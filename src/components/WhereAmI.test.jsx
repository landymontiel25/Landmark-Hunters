// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let geo = { coords: null };
vi.mock('../lib/GeoContext', () => ({ useGeo: () => geo }));
vi.mock('../lib/customLandmarks', () => ({ getCustomLandmarks: async () => [{ id: 'budare', region: 'custom', name: 'Budare Bistro', lat: 25.7601, lng: -80.2101 }] }));
const street = vi.fn(async () => '1801 SW 3rd Avenue, Miami, Florida');
vi.mock('../lib/geocode', () => ({ streetAddress: (...a) => street(...a) }));

const { default: WhereAmI } = await import('./WhereAmI');
const { ALL_LANDMARKS } = await import('../data/regions');

let root;
let host;
const draw = () => root.render(<MemoryRouter><WhereAmI /></MemoryRouter>);
async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => draw());
  await act(async () => {}); // let lookups settle
}
const text = () => host.textContent;

describe('WhereAmI', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    street.mockClear();
  });
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    vi.useRealTimers();
  });

  it('shows nothing without a location', async () => {
    geo = { coords: null };
    await mount();
    expect(text()).toBe('');
  });

  it('names the landmark you are at and tells the layout its height', async () => {
    const lm = ALL_LANDMARKS.find((l) => l.regionId === 'miami' && Number.isFinite(l.lat));
    geo = { coords: { lat: lm.lat, lng: lm.lng, accuracy: 10 } };
    await mount();
    expect(text()).toContain(`At ${lm.name}`);
    expect(document.documentElement.style.getPropertyValue('--whereami-h')).not.toBe('');
  });

  it('names a place someone added', async () => {
    geo = { coords: { lat: 25.7601, lng: -80.2101, accuracy: 10 } };
    await mount();
    expect(text()).toContain('At Budare Bistro');
  });

  it("shows the street when you're at no place", async () => {
    geo = { coords: { lat: 10.5, lng: -66.9, accuracy: 10 } };
    await mount();
    expect(text()).toContain('1801 SW 3rd Avenue, Miami');
  });

  it('says Traveling… while you move, then names the spot once you stop', async () => {
    geo = { coords: { lat: 10.5, lng: -66.9, accuracy: 10 } };
    await mount();
    await act(async () => {
      vi.advanceTimersByTime(12_000);
      geo = { coords: { lat: 10.502, lng: -66.9, accuracy: 10 } }; // ~220 m in 12 s
      draw();
    });
    expect(text()).toContain('Traveling…');
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await act(async () => {});
    expect(text()).toContain('1801 SW 3rd Avenue, Miami');
  });
});
