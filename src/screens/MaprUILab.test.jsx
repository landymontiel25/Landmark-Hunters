// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

function MaprStub() {
  const { state } = useLocation();
  return <p className="mapr-stub">{state?.ask || (state?.openChats ? 'chats' : 'mapr')}</p>;
}

async function render({ chats = [], openChat = () => {} } = {}) {
  vi.doMock('../lib/AuthContext', () => ({
    useAuth: () => ({
      user: { uid: 'u', email: 'a@b.c', displayName: 'Landy Montiel' },
    }),
  }));
  vi.doMock('../lib/MaprChatContext', () => ({
    useMaprChat: () => ({ chats, openChat }),
  }));
  const { default: MaprUILab } = await import('./MaprUILab.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MemoryRouter initialEntries={['/test']}>
        <Routes>
          <Route path="/test" element={<MaprUILab />} />
          <Route path="/mapr" element={<MaprStub />} />
          <Route path="/profile" element={<p>profile</p>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container;
}

const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));

describe('MaprUILab (Test tab: UI)', () => {
  it('greets you by first name and shows the mockup sections', async () => {
    const el = await render();
    expect(el.querySelector('.mui-hello').textContent).toBe('Hey Landy,');
    expect(el.querySelector('.mui-avatar').textContent).toBe('LM');
    expect(el.textContent).toContain('What are you in the mood for?');
    expect([...el.querySelectorAll('.mui-chip')].map((c) => c.textContent)).toEqual([
      'Dinner tonight',
      'A full day itinerary',
      'Outdoors',
      'Hidden gems',
      'Under $50',
      'Keep it lowkey',
    ]);
    expect(el.textContent).toContain('Try asking about...');
    expect(el.textContent).toContain('Your recent chats');
    expect(el.querySelectorAll('.mui-card img').length).toBeGreaterThan(2);
  });

  it('a chip fills the ask bar, and send asks Mapr', async () => {
    const el = await render();
    await click(button(el, 'Dinner tonight'));
    expect(el.querySelector('.mui-ask input').value).toBe('Dinner tonight in Miami');
    await click(el.querySelector('.mui-send'));
    expect(el.querySelector('.mapr-stub').textContent).toBe('Dinner tonight in Miami');
  });

  it('switching city changes the cards and the chip question', async () => {
    const el = await render();
    await click(el.querySelector('.mui-city'));
    await click([...el.querySelectorAll('.mui-city-menu button')].find((b) => b.textContent === 'San Francisco'));
    expect(el.querySelector('.mui-city').textContent).toContain('San Francisco');
    expect(el.textContent).toContain('A full dayin San Francisco');
    await click(button(el, 'Outdoors'));
    expect(el.querySelector('.mui-ask input').value).toBe('Something outdoors in San Francisco');
  });

  it('a photo card asks its question', async () => {
    const el = await render();
    await click(el.querySelector('.mui-card'));
    expect(el.querySelector('.mapr-stub').textContent).toBe('Best dinner spots tonight in Miami');
  });

  it('shows your own recent chats and opens one', async () => {
    const openChat = vi.fn();
    const el = await render({
      chats: [{ id: 'c1', title: 'Tacos in Brickell' }],
      openChat,
    });
    expect(el.querySelectorAll('.mui-row').length).toBe(1);
    await click(button(el, 'Tacos in Brickell'));
    expect(openChat).toHaveBeenCalledWith('c1');
    expect(el.querySelector('.mapr-stub').textContent).toBe('mapr');
  });

  it('with no chats yet, sample rows ask Mapr', async () => {
    const el = await render();
    await click(button(el, 'Plan a weekend in Miami'));
    expect(el.querySelector('.mapr-stub').textContent).toBe('Plan a weekend in Miami');
  });
});
