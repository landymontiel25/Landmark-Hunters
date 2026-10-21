// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The Itinerary tutorial (Test tab): the first-visit sheet over the
// Itinerary tab, Skip or Show me, then each step with Back, Next and Skip.
let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

async function render() {
  vi.doMock('./tutorialTabScreens', () => ({ TAB_SCREENS: {} }));
  const { default: ItineraryTutorialLab } = await import('./ItineraryTutorialLab.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <ItineraryTutorialLab />
      </MemoryRouter>
    )
  );
  return container;
}
const click = (el) => act(async () => el.click());
const button = (el, text) => {
  const all = [...el.querySelectorAll('button')];
  return all.find((b) => b.textContent.trim() === text) || all.find((b) => b.textContent.includes(text));
};

describe('Itinerary tutorial', () => {
  it('asks first, and Show me walks every step in order to the end', async () => {
    const { STEPS } = await import('./itineraryTutorialSteps.js');
    const el = await render();
    expect(el.textContent).toContain('Want to learn how to make an itinerary?');
    expect(button(el, 'Skip')).toBeTruthy();
    await click(button(el, 'Show me'));
    for (const [i, step] of STEPS.entries()) {
      expect(el.textContent).toContain(`Step ${i + 1} of ${STEPS.length}: ${step.title}`);
      expect(el.textContent).toContain(step.say[0]);
      expect(button(el, 'Back').disabled).toBe(i === 0);
      await click(button(el, i === STEPS.length - 1 ? 'Finish' : 'Next'));
    }
    expect(el.textContent).toContain("You're ready.");
    await click(button(el, 'Restart'));
    expect(el.textContent).toContain('Want to learn how to make an itinerary?');
  });

  it('Skip on the first sheet, or Skip tutorial on any step, ends it', async () => {
    const el = await render();
    await click(button(el, 'Skip'));
    expect(el.textContent).toContain('No problem.');
    await click(button(el, 'Restart'));
    await click(button(el, 'Show me'));
    await click(button(el, 'Next'));
    await click(button(el, 'Skip tutorial'));
    expect(el.textContent).toContain('No problem.');
  });

  it('teaches only what the tab really has, in plain words', async () => {
    const { INTRO, STEPS } = await import('./itineraryTutorialSteps.js');
    const text = [...Object.values(INTRO), ...STEPS.flatMap((s) => [s.title, ...s.say])].join(' ');
    expect(text).not.toMatch(/—/);
    for (const feature of ['Use Mapr', 'bookmark', 'Edit List', 'Start Trip', 'Share', 'Add a user', 'Past']) expect(text).toContain(feature);
  });
});
