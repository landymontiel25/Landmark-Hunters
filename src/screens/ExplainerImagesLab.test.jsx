// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The "5 images" intro (Test tab): five live screens with Next, dots and
// Skip, and something to tap on each one.
let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

async function render() {
  vi.doMock('../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'imperial' }), formatDistance: (m) => `${Math.round(m)} m` }));
  const { default: ExplainerImagesLab } = await import('./ExplainerImagesLab.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  function Landmark() {
    return <p className="landmark-page">{useLocation().pathname}</p>;
  }
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter initialEntries={['/test']}>
        <Routes>
          <Route path="/test" element={<ExplainerImagesLab />} />
          <Route path="/landmarks/:region/:id" element={<Landmark />} />
        </Routes>
      </MemoryRouter>
    )
  );
  return container;
}
const page = (el) => el.querySelector('.landmark-page')?.textContent;

const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const title = (el) => el.querySelector('.intro-title').textContent;

describe('5 images intro', () => {
  it("shows the owner's exact title and caption on every screen", async () => {
    const el = await render();
    const want = [
      ['Discover', 'Discover places worth visiting.'],
      ['Arrive prepared', 'Arrive prepared with what to know before you go.'],
      ['Plan Less', 'Explore with a clear route that saves you time.'],
      ['Play', 'Play and share the fun with family and friends.'],
      ['Remember', 'Remember your favorite places and memories organized and in one place.'],
    ];
    for (const [i, [t, line]] of want.entries()) {
      expect(title(el)).toBe(t);
      expect(el.querySelector('.intro-line').textContent).toBe(line);
      if (i < want.length - 1) await click(button(el, 'Next'));
    }
  });

  it('Next walks the five screens, then Start exploring finishes', async () => {
    const el = await render();
    const seen = [title(el)];
    for (let i = 0; i < 4; i++) {
      await click(button(el, 'Next'));
      seen.push(title(el));
    }
    expect(seen).toEqual(['Discover', 'Arrive prepared', 'Plan Less', 'Play', 'Remember']);
    expect(el.textContent).toContain('5 of 5');
    await click(button(el, 'Start exploring'));
    expect(title(el)).toBe("You're all set");
    await click(button(el, 'Watch again'));
    expect(title(el)).toBe('Discover');
  });

  it('dots jump to a screen and Skip ends the intro', async () => {
    const el = await render();
    await click(el.querySelector('[role="tab"][aria-label="Play"]'));
    expect(title(el)).toBe('Play');
    await click(button(el, 'Back'));
    expect(title(el)).toBe('Plan Less');
    await click(button(el, 'Skip'));
    expect(title(el)).toBe("You're all set");
  });

  it('Discover: hearts save a place; a card opens its page, with no description', async () => {
    const el = await render();
    const heart = el.querySelector('.intro-heart');
    await click(heart);
    expect(heart.getAttribute('aria-pressed')).toBe('true');
    expect(el.textContent).not.toContain('Declaration of Independence');
    await click(el.querySelector('.intro-place-body'));
    expect(page(el)).toBe('/landmarks/philly/independence-hall');
  });

  it('Arrive prepared: the photo opens its landmark', async () => {
    const el = await render();
    await click(button(el, 'Next'));
    await click(el.querySelector('.intro-photo-link'));
    expect(page(el)).toBe('/landmarks/philly/independence-hall');
  });

  it('Arrive prepared: rows open with the landmark facts', async () => {
    const el = await render();
    await click(button(el, 'Next'));
    await click(button(el, 'The story behind it'));
    expect(el.querySelectorAll('.intro-row-body li').length).toBeGreaterThan(0);
    await click(button(el, 'How long it takes'));
    expect(el.textContent).toContain('about 45 minutes');
  });

  it('Plan Less shows the real map with the three numbered stops', async () => {
    const el = await render();
    await click(el.querySelector('[role="tab"][aria-label="Plan Less"]'));
    expect(el.querySelector('.intro-map.leaflet-container')).toBeTruthy();
    expect([...el.querySelectorAll('.intro-map-pin')].map((p) => p.textContent)).toEqual(['1', '2', '3']);
    expect(el.querySelector('.intro-map path.leaflet-interactive')).toBeTruthy();
  });

  it('Plan Less: tapping a stop opens its page, with no extra caption', async () => {
    const el = await render();
    await click(el.querySelector('[role="tab"][aria-label="Plan Less"]'));
    expect(el.querySelectorAll('.intro-stop').length).toBe(3);
    expect(el.textContent).not.toContain('min here');
    await click(el.querySelectorAll('.intro-stop')[2]);
    expect(page(el)).toBe('/landmarks/philly/philadelphia-museum-of-art');
  });

  it('Play: check in at a landmark shows the discovered toast; a Remember photo opens its place', async () => {
    const { ALL_LANDMARKS } = await import('../data/regions');
    const hall = ALL_LANDMARKS.find((l) => l.id === 'independence-hall');
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok) => ok({ coords: { latitude: hall.lat, longitude: hall.lng } }) },
    });
    const el = await render();
    await click(el.querySelector('[role="tab"][aria-label="Play"]'));
    await click(button(el, 'Check in'));
    expect(el.textContent).toContain('New place discovered!');
    await click(button(el, 'Next'));
    await click(el.querySelector('.intro-memory'));
    expect(page(el)).toBe('/landmarks/philly/independence-hall');
  });

  const play = async () => {
    const el = await render();
    await click(el.querySelector('[role="tab"][aria-label="Play"]'));
    return el;
  };
  const fakeGeo = (impl) => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: impl } });
  };

  it('Check in far from any landmark names the closest one and how far it is', async () => {
    // Out in the Atlantic: nothing is within reach, so it reports the nearest.
    fakeGeo((ok) => ok({ coords: { latitude: 30, longitude: -60 } }));
    const el = await play();
    await click(button(el, 'Check in'));
    expect(el.querySelector('.intro-nearby').textContent).toMatch(/Closest landmark: .+, \d+ m away\./);
    expect(button(el, 'Check in')).toBeTruthy();
  });

  it('Check in at a landmark says you are there and checks you in', async () => {
    const { ALL_LANDMARKS } = await import('../data/regions');
    const hall = ALL_LANDMARKS.find((l) => l.id === 'independence-hall');
    fakeGeo((ok) => ok({ coords: { latitude: hall.lat, longitude: hall.lng } }));
    const el = await play();
    await click(button(el, 'Check in'));
    expect(el.querySelector('.intro-nearby').textContent).toContain('You are at');
    expect(button(el, 'Checked in')).toBeTruthy();
  });

  it('Check in with location refused asks you to turn it on', async () => {
    fakeGeo((_ok, fail) => fail({ code: 1 }));
    const el = await play();
    await click(button(el, 'Check in'));
    expect(el.querySelector('.intro-nearby').textContent).toContain('Turn on location');
  });
});
