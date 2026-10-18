// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let geo = { coords: null };
let checkin = { user: { uid: 'me' }, firebaseEnabled: true, claimedMap: {}, checkingIn: null, checkIn: vi.fn() };
vi.mock('../lib/useCheckIn', () => ({ useCheckIn: () => checkin }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => geo }));
const defaultCustom = [{ id: 'budare', region: 'custom', name: 'Budare Bistro', lat: 25.7601, lng: -80.2101 }];
let customList = defaultCustom;
vi.mock('../lib/customLandmarks', () => ({ getCustomLandmarks: async () => customList }));
const street = vi.fn(async () => '1801 SW 3rd Avenue, Miami, Florida');
vi.mock('../lib/geocode', () => ({ streetAddress: (...a) => street(...a) }));
const google = vi.fn(async () => null);
vi.mock('../lib/placeLookup', () => ({ reverseGeocodePlace: (...a) => google(...a) }));

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
    street.mockReset();
    street.mockImplementation(async () => '1801 SW 3rd Avenue, Miami, Florida');
    google.mockReset();
    google.mockImplementation(async () => null);
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

  it('falls back to Google when OpenStreetMap has no address', async () => {
    street.mockImplementation(async () => null);
    google.mockImplementation(async () => ({ name: 'Some Shop', address: '200 SW 8th St, Miami, FL' }));
    geo = { coords: { lat: 10.5, lng: -66.9, accuracy: 10 } };
    await mount();
    expect(text()).toContain('200 SW 8th St, Miami');
  });

  it('is never blank with a location: nearest place, else "Finding your spot…"', async () => {
    street.mockImplementation(async () => null);
    const lm = ALL_LANDMARKS.find((l) => l.regionId === 'miami' && Number.isFinite(l.lat));
    geo = { coords: { lat: lm.lat + 0.002, lng: lm.lng, accuracy: 10 } }; // ~220 m away
    await mount();
    expect(text()).toMatch(/^.Near /u);
    act(() => root.unmount());
    host.remove();
    geo = { coords: { lat: 10.5, lng: -66.9, accuracy: 10 } };
    await mount();
    expect(text()).toContain('Finding your spot…');
  });

  it('shows a Check in button within 30 m of a place and opens the usual check-in sheet', async () => {
    checkin = { ...checkin, checkIn: vi.fn() };
    geo = { coords: { lat: 25.7601, lng: -80.2101, accuracy: 10 } }; // at Budare Bistro
    await mount();
    const btn = host.querySelector('.where-am-i-checkin');
    expect(btn.textContent).toContain('Check in');
    await act(async () => btn.click());
    expect(checkin.checkIn).toHaveBeenCalledWith(expect.objectContaining({ id: 'budare', name: 'Budare Bistro' }));
  });

  it('hides the button past 30 m (the pill can still say "At …"), and when signed out', async () => {
    geo = { coords: { lat: 25.76045, lng: -80.2101, accuracy: 10 } }; // ~39 m away
    await mount();
    expect(text()).toContain('At Budare Bistro');
    expect(host.querySelector('.where-am-i-checkin')).toBeNull();
    act(() => root.unmount());
    host.remove();
    checkin = { ...checkin, user: null };
    geo = { coords: { lat: 25.7601, lng: -80.2101, accuracy: 10 } };
    await mount();
    expect(host.querySelector('.where-am-i-checkin')).toBeNull();
    checkin = { ...checkin, user: { uid: 'me' } };
  });

  it('says "Check in again" at a place you already checked into', async () => {
    checkin = { ...checkin, claimedMap: { budare: true } };
    geo = { coords: { lat: 25.7601, lng: -80.2101, accuracy: 10 } };
    await mount();
    expect(host.querySelector('.where-am-i-checkin').textContent).toContain('Check in again');
    checkin = { ...checkin, claimedMap: {} };
  });

  it('lists every place within 30 m, the ones you have not checked into first', async () => {
    const { ALL_LANDMARKS } = await import('../data/regions');
    const lm = ALL_LANDMARKS.find((l) => l.regionId === 'miami' && Number.isFinite(l.lat));
    // Budare Bistro is already checked into; a second place added next to the landmark.
    const near = [lm, { id: 'budare', name: 'Budare Bistro', lat: lm.lat + 0.0001, lng: lm.lng }];
    customList = near.slice(1);
    checkin = { ...checkin, claimedMap: { budare: true }, checkIn: vi.fn() };
    geo = { coords: { lat: lm.lat, lng: lm.lng, accuracy: 10 } };
    await mount();
    const toggle = host.querySelector('.where-am-i-checkin');
    expect(toggle.textContent).toMatch(/2 places here/);
    await act(async () => toggle.click());
    const rows = [...host.querySelectorAll('.where-am-i-list-row')];
    expect(rows.map((r) => r.querySelector('.where-am-i-list-name').textContent)).toEqual([lm.name, 'Budare Bistro']);
    expect(rows[1].querySelector('button').textContent).toBe('Check in again');
    await act(async () => rows[0].querySelector('button').click());
    expect(checkin.checkIn).toHaveBeenCalledWith(expect.objectContaining({ id: lm.id }));
    customList = defaultCustom;
    checkin = { ...checkin, claimedMap: {} };
  });
});
