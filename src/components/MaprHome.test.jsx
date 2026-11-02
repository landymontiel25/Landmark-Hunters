// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, useEffect, useState } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

async function render({ chats = [], synced = true, score = null, scoreEstimated = false } = {}) {
  vi.doMock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u', email: 'a@b.c', displayName: 'Landy Montiel' } }) }));
  const { default: MaprHome } = await import('./MaprHome.jsx');
  const calls = { asked: [], opened: [], seeAll: 0, regions: null, orb: 0 };
  function Host() {
    const [regions, setRegions] = useState([{ id: 'miami', name: 'Miami' }]);
    const [draft, setDraft] = useState('');
    useEffect(() => {
      calls.regions = regions;
    }, [regions]);
    return (
      <MaprHome
        regions={regions}
        onSetRegions={setRegions}
        draft={draft}
        onDraft={setDraft}
        onAsk={(t) => calls.asked.push(t)}
        chats={chats}
        onOpenChat={(id) => calls.opened.push(id)}
        onSeeAllChats={synced ? () => calls.seeAll++ : null}
        score={score}
        scoreEstimated={scoreEstimated}
        onOrbTap={() => calls.orb++}
      >
        <p className="extra">taste card</p>
      </MaprHome>
    );
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MemoryRouter initialEntries={['/mapr']}>
        <Routes>
          <Route path="/mapr" element={<Host />} />
          <Route path="/profile" element={<p className="profile">profile</p>} />
        </Routes>
      </MemoryRouter>
    );
  });
  return { el: container, calls };
}

const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const submit = (el) => act(async () => el.querySelector('form.mui-ask').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

describe('MaprHome (the Mapr tab before a conversation)', () => {
  it('greets you by first name and shows the design', async () => {
    const { el } = await render();
    expect(el.querySelector('.mui-hello').textContent).toBe('Hey Landy,');
    expect(el.querySelector('.mui-avatar').textContent).toBe('LM');
    expect(el.querySelector('.mui-city').textContent).toContain('Miami');
    expect(el.textContent).toContain('What are you in the mood for?');
    expect([...el.querySelectorAll('.mui-chip')].map((c) => c.textContent)).toEqual(['Dinner tonight', 'A full day itinerary', 'Outdoors', 'Hidden gems', 'Under $50', 'Keep it lowkey']);
    expect(el.textContent).toContain('Try asking about...');
    expect(el.querySelectorAll('.mui-card img').length).toBeGreaterThan(2);
    expect(el.querySelector('.extra')).toBeTruthy();
  });

  it('a chip fills the ask bar, and send asks Mapr', async () => {
    const { el, calls } = await render();
    await click(button(el, 'Dinner tonight'));
    expect(el.querySelector('.mui-ask input').value).toBe('Dinner tonight in Miami');
    await submit(el);
    expect(calls.asked).toEqual(['Dinner tonight in Miami']);
  });

  it('an empty ask bar sends nothing', async () => {
    const { el, calls } = await render();
    await submit(el);
    expect(calls.asked).toEqual([]);
  });

  it('the city pill sets Mapr’s city, or Any city', async () => {
    const { el, calls } = await render();
    await click(el.querySelector('.mui-city'));
    await click([...el.querySelectorAll('.mui-city-menu button')].find((b) => b.textContent === 'San Francisco'));
    expect(calls.regions.map((r) => r.id)).toEqual(['san-francisco']);
    expect(el.textContent).toContain('A full dayin San Francisco');
    await click(el.querySelector('.mui-city'));
    await click([...el.querySelectorAll('.mui-city-menu button')].find((b) => b.textContent === 'Any city'));
    expect(calls.regions).toEqual([]);
    expect(el.querySelector('.mui-city').textContent).toContain('Any city');
    await click(button(el, 'Outdoors'));
    expect(el.querySelector('.mui-ask input').value).toBe('Something outdoors');
  });

  it('a photo card asks its question', async () => {
    const { el, calls } = await render();
    await click(el.querySelector('.mui-card'));
    expect(calls.asked).toEqual(['Best dinner spots tonight in Miami']);
  });

  it('recent chats: your last three, tap to open, See all opens the list', async () => {
    const chats = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: `Chat ${id}` }));
    const { el, calls } = await render({ chats });
    expect([...el.querySelectorAll('.mui-row-title')].map((t) => t.textContent)).toEqual(['Chat a', 'Chat b', 'Chat c']);
    await click(button(el, 'Chat b'));
    expect(calls.opened).toEqual(['b']);
    await click([...el.querySelectorAll('.mui-recent-head .mui-see-all')][0]);
    expect(calls.seeAll).toBe(1);
  });

  it('recent chats sit right under the ask bar, above the chips', async () => {
    const { el } = await render({ chats: [{ id: 'a', title: 'Chat a' }] });
    const order = [...el.querySelectorAll('.mui-ask, .mui-recent, .mui-chips')].map((n) => n.className.split(' ')[0]);
    expect(order).toEqual(['mui-ask', 'mui-recent', 'mui-chips']);
  });

  it('the orb shows the Mapr Score and opens it on tap', async () => {
    const { el, calls } = await render({ score: 72 });
    expect(el.querySelector('.mui-orb-score').textContent).toBe('72%Mapr Score');
    await click(el.querySelector('.mui-orb-wrap'));
    expect(calls.orb).toBe(1);
  });

  it('an estimated score shows with ~, and none yet shows …', async () => {
    const est = await render({ score: 40, scoreEstimated: true });
    expect(est.el.querySelector('.mui-orb-score strong').textContent).toBe('~40%');
    container.remove();
    vi.resetModules();
    const none = await render();
    expect(none.el.querySelector('.mui-orb-score strong').textContent).toBe('…');
  });

  it('with no chats there is no recent chats section', async () => {
    const { el } = await render();
    expect(el.textContent).not.toContain('Your recent chats');
  });

  it('the avatar opens Profile', async () => {
    const { el } = await render();
    await click(el.querySelector('.mui-avatar'));
    expect(el.querySelector('.profile')).toBeTruthy();
  });
});
