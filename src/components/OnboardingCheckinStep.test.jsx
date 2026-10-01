// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
  vi.clearAllMocks();
});

const here = { id: 'here', name: 'Here Hall', lat: 25.0, lng: -80.0 };
const faraway = { id: 'faraway', name: 'Faraway Tower', lat: 25.5, lng: -80.0 };
const metersNorth = (m, accuracy = 10) => ({ lat: 25.0 + m / 111195, lng: -80.0, accuracy });

async function mount({ coords, loading = false, claimed = {} }) {
  const onDone = vi.fn();
  const checkIn = vi.fn();
  vi.doMock('../data/regions', () => ({ ALL_LANDMARKS: [here, faraway] }));
  vi.doMock('../lib/useCheckIn', () => ({
    useCheckIn: () => ({ user: { uid: 'u' }, firebaseEnabled: true, claimedMap: claimed, checkingIn: null, checkIn }),
  }));
  vi.doMock('../lib/GeoContext', () => ({ useGeo: () => ({ coords, loading }) }));
  vi.doMock('../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'metric' }), formatDistance: (m) => `${m} m` }));
  vi.doMock('./LandmarkThumb', () => ({ default: () => null }));
  const { default: Step } = await import('./OnboardingCheckinStep.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<Step onDone={onDone} />));
  return { el: container, onDone, checkIn };
}
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));

describe('OnboardingCheckinStep', () => {
  it('offers only the place you are at, never the far one, and Skip works', async () => {
    const { el, onDone } = await mount({ coords: metersNorth(8) });
    expect(el.textContent).toContain('Here Hall');
    expect(el.textContent).not.toContain('Faraway Tower');
    await act(async () => button(el, 'Skip for now').click());
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('tapping Check In opens the usual rate + post prompt for that place', async () => {
    const { el, checkIn } = await mount({ coords: metersNorth(8) });
    await act(async () => button(el, 'Check In').click());
    expect(checkIn).toHaveBeenCalledWith(here);
  });

  it('with nothing nearby: a friendly message and only the skip button, no landmark', async () => {
    const { el, onDone } = await mount({ coords: metersNorth(5000) });
    expect(el.textContent).toContain("not at one of our places");
    expect(el.textContent).not.toContain('Here Hall');
    expect(button(el, 'Check In')).toBeUndefined();
    await act(async () => button(el, 'Skip for now').click());
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('without location it is not a dead end', async () => {
    const { el, onDone } = await mount({ coords: null });
    expect(el.textContent).toContain("can't see your location");
    await act(async () => button(el, 'Skip for now').click());
    expect(onDone).toHaveBeenCalled();
  });

  it('with a too-weak GPS signal it offers nothing and says why', async () => {
    const { el } = await mount({ coords: metersNorth(3, 400) });
    expect(el.textContent).toContain('too weak');
    expect(el.textContent).not.toContain('Here Hall');
  });

  it('after checking in, the button becomes Continue', async () => {
    const { el } = await mount({ coords: metersNorth(8), claimed: { here: true } });
    expect(button(el, 'Continue')).toBeDefined();
    expect(button(el, 'Skip for now')).toBeUndefined();
  });
});
