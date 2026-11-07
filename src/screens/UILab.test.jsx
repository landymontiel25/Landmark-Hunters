// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  document.body.classList.remove('ui-lab-full');
  vi.resetModules();
});

async function render() {
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u', email: 'a@b.c', displayName: 'Landy Montiel' } }) }));
  // The Map screen has its own tests (MapUILab.test.jsx).
  vi.doMock('./MapUILab', () => ({ default: ({ fullScreen }) => <p className={`map-ui-stub ${fullScreen ? 'full' : ''}`}>map</p> }));
  // The Apple-style Landmarks, Itinerary and Profile wrap the real screens.
  vi.doMock('./AppleScreens', () => ({
    LandmarksUILab: () => <p className="apple-stub">Landmarks screen</p>,
    ItineraryUILab: () => <p className="apple-stub">Itinerary screen</p>,
    ProfileUILab: () => <p className="apple-stub">Profile screen</p>,
  }));
  const { default: UILab } = await import('./UILab.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MemoryRouter initialEntries={['/test']}>
        <Routes>
          <Route path="/test" element={<UILab />} />
          <Route path="/mapr" element={<p className="mapr-tab">mapr tab</p>} />
        </Routes>
      </MemoryRouter>
    );
  });
  return container;
}

const click = (el) => act(async () => el.click());
const tab = (el, label) => [...el.querySelectorAll('.uil-tab')].find((t) => t.textContent === label);

describe('UILab (Test tab: UI)', () => {
  it('has a sub-tab per app tab and opens on Map', async () => {
    const el = await render();
    expect([...el.querySelectorAll('.uil-tab')].map((t) => t.textContent)).toEqual(['Map', 'Landmarks', 'Mapr', 'Itinerary', 'Profile']);
    expect(tab(el, 'Map').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('.uil-frame .map-ui-stub')).toBeTruthy();
  });

  it('Mapr is live in the app now: its slot links to the Mapr tab', async () => {
    const el = await render();
    await click(tab(el, 'Mapr'));
    expect(el.querySelector('.mui')).toBeNull();
    expect(el.querySelector('.uil-empty').textContent).toContain('Live in the app');
    await click(el.querySelector('.uil-open-live'));
    expect(el.querySelector('.mapr-tab')).toBeTruthy();
  });

  it('every screen has the floating tab bar at its bottom, in step with the sub-tabs', async () => {
    const el = await render();
    const bar = () => [...el.querySelectorAll('.uil-frame .uil-tabbar button')];
    expect(bar().map((b) => b.textContent)).toEqual(['Map', 'Landmarks', 'Mapr', 'Itinerary', 'Profile', 'Test']);
    expect(bar()[0].getAttribute('aria-current')).toBe('page');
    await click(bar()[3]);
    expect(tab(el, 'Itinerary').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('.uil-frame .apple-stub').textContent).toBe('Itinerary screen');
    await click(tab(el, 'Map'));
    expect(bar()[0].getAttribute('aria-current')).toBe('page');
    expect(el.querySelector('.uil-frame .map-ui-stub')).toBeTruthy();
    expect(el.querySelector('.uil-exit')).toBeNull();
  });

  it('Map, Landmarks, Itinerary and Profile each have their Apple-style screen', async () => {
    const el = await render();
    await click(tab(el, 'Map'));
    expect(el.querySelector('.map-ui-stub')).toBeTruthy();
    for (const label of ['Landmarks', 'Itinerary', 'Profile']) {
      await click(tab(el, label));
      expect(el.querySelector('.uil-empty')).toBeNull();
      expect(el.querySelector('.apple-stub').textContent).toBe(`${label} screen`);
    }
  });

  it('Full screen hides the app chrome, has its own tab bar, and exits', async () => {
    const el = await render();
    await click(el.querySelector('button[aria-label="Full screen"]'));
    expect(document.body.classList.contains('ui-lab-full')).toBe(true);
    expect(el.querySelector('.uil-full .map-ui-stub.full')).toBeTruthy();
    const bar = [...el.querySelectorAll('.uil-tabbar button')];
    expect(bar.map((b) => b.textContent)).toEqual(['Map', 'Landmarks', 'Mapr', 'Itinerary', 'Profile', 'Test']);
    await click(bar[0]);
    expect(el.querySelector('.uil-full .map-ui-stub.full')).toBeTruthy();
    expect(el.querySelector('.uil-exit').classList.contains('low-right')).toBe(true);
    await click(bar[1]);
    expect(el.querySelector('.uil-full .apple-stub').textContent).toBe('Landmarks screen');
    await click(el.querySelector('.uil-exit'));
    expect(document.body.classList.contains('ui-lab-full')).toBe(false);
    expect(el.querySelector('.uil-full')).toBeNull();
    expect(tab(el, 'Landmarks').getAttribute('aria-selected')).toBe('true');
  });

  it("the capsule's Test tab leaves Full screen", async () => {
    const el = await render();
    await click(el.querySelector('button[aria-label="Full screen"]'));
    await click([...el.querySelectorAll('.uil-tabbar button')].find((b) => b.textContent === 'Test'));
    expect(el.querySelector('.uil-full')).toBeNull();
  });
});
