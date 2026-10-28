// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

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
  await act(async () => createRoot(container).render(<ExplainerImagesLab />));
  return container;
}

const click = (el) => act(async () => el.click());
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const title = (el) => el.querySelector('.intro-title').textContent;

describe('5 images intro', () => {
  it('Next walks the five screens, then Start exploring finishes', async () => {
    const el = await render();
    const seen = [title(el)];
    for (let i = 0; i < 4; i++) {
      await click(button(el, 'Next'));
      seen.push(title(el));
    }
    expect(seen).toEqual(['Discover', 'Arrive prepared', 'Plan less', 'Play', 'Remember']);
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
    expect(title(el)).toBe('Plan less');
    await click(button(el, 'Skip'));
    expect(title(el)).toBe("You're all set");
  });

  it('Discover: hearts save a place and a card opens its summary', async () => {
    const el = await render();
    const heart = el.querySelector('.intro-heart');
    await click(heart);
    expect(heart.getAttribute('aria-pressed')).toBe('true');
    await click(el.querySelector('.intro-place-body'));
    expect(el.textContent).toContain('Declaration of Independence');
  });

  it('Arrive prepared: rows open with the landmark facts', async () => {
    const el = await render();
    await click(button(el, 'Next'));
    await click(button(el, 'The story behind it'));
    expect(el.querySelectorAll('.intro-row-body li').length).toBeGreaterThan(0);
    await click(button(el, 'How long it takes'));
    expect(el.textContent).toContain('about 45 minutes');
  });

  it('Plan less: tapping a stop selects it', async () => {
    const el = await render();
    await click(el.querySelector('[role="tab"][aria-label="Plan less"]'));
    expect(el.querySelectorAll('.intro-stop').length).toBe(3);
    await click(el.querySelectorAll('.intro-stop')[2]);
    expect(el.querySelectorAll('.intro-stop')[2].getAttribute('aria-pressed')).toBe('true');
  });

  it('Play: check in shows the discovered toast; Remember opens a photo', async () => {
    const el = await render();
    await click(el.querySelector('[role="tab"][aria-label="Play"]'));
    await click(button(el, 'Check in'));
    expect(el.textContent).toContain('New place discovered!');
    await click(button(el, 'Next'));
    await click(el.querySelector('.intro-memory'));
    expect(el.querySelector('.intro-memory-big')).toBeTruthy();
  });
});
