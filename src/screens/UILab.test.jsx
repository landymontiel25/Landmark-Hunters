// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

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
  vi.doMock('../lib/MaprChatContext', () => ({ useMaprChat: () => ({ chats: [], openChat: () => {} }) }));
  const { default: UILab } = await import('./UILab.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MemoryRouter>
        <UILab />
      </MemoryRouter>
    );
  });
  return container;
}

const click = (el) => act(async () => el.click());
const tab = (el, label) => [...el.querySelectorAll('.uil-tab')].find((t) => t.textContent === label);

describe('UILab (Test tab: UI)', () => {
  it('has a sub-tab per app tab and opens on Mapr', async () => {
    const el = await render();
    expect([...el.querySelectorAll('.uil-tab')].map((t) => t.textContent)).toEqual(['Map', 'Landmarks', 'Mapr', 'Itinerary', 'Profile']);
    expect(tab(el, 'Mapr').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('.mui')).toBeTruthy();
  });

  it('Map has its screen; the others are empty placeholders for now', async () => {
    const el = await render();
    await click(tab(el, 'Map'));
    expect(el.querySelector('.map-ui-stub')).toBeTruthy();
    for (const label of ['Landmarks', 'Itinerary', 'Profile']) {
      await click(tab(el, label));
      expect(el.querySelector('.mui')).toBeNull();
      expect(el.querySelector('.uil-empty').textContent).toBe(`${label}Not designed yet`);
    }
  });

  it('Full screen hides the app chrome, has its own tab bar, and exits', async () => {
    const el = await render();
    await click(el.querySelector('button[aria-label="Full screen"]'));
    expect(document.body.classList.contains('ui-lab-full')).toBe(true);
    expect(el.querySelector('.uil-full .mui.mui-full')).toBeTruthy();
    const bar = [...el.querySelectorAll('.uil-tabbar button')];
    expect(bar.map((b) => b.textContent)).toEqual(['Map', 'Landmarks', 'Mapr', 'Itinerary', 'Profile']);
    await click(bar[0]);
    expect(el.querySelector('.uil-full .map-ui-stub.full')).toBeTruthy();
    expect(el.querySelector('.uil-exit').classList.contains('low-right')).toBe(true);
    await click(bar[1]);
    expect(el.querySelector('.uil-full .uil-empty').textContent).toContain('Landmarks');
    await click(el.querySelector('.uil-exit'));
    expect(document.body.classList.contains('ui-lab-full')).toBe(false);
    expect(el.querySelector('.uil-full')).toBeNull();
    expect(tab(el, 'Landmarks').getAttribute('aria-selected')).toBe('true');
  });
});
