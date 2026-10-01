// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

async function render({ coords, geoLoading }) {
  vi.doMock('../lib/useCheckIn', () => ({
    useCheckIn: () => ({ user: { uid: 'u' }, firebaseEnabled: true, claimedMap: {}, checkingIn: null, checkIn: vi.fn() }),
  }));
  vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords, loading: geoLoading }) }));
  vi.doMock('../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: () => '1 mi' }));
  vi.doMock('./CheckInButton', () => ({ default: () => <button>CHECK IN</button> }));
  vi.doMock('./LandmarkThumb', () => ({ default: () => null }));
  const { default: Step } = await import('./FirstCheckInStep.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<Step required onDone={() => {}} />));
  return container.textContent;
}

describe('FirstCheckInStep (required)', () => {
  it('is not a dead end when location is denied', async () => {
    expect(await render({ coords: null, geoLoading: false })).toContain('Skip for now');
  });
  it('still waits while the first fix is loading', async () => {
    expect(await render({ coords: null, geoLoading: true })).not.toContain('Skip for now');
  });
});
