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

async function render(props) {
  const save = vi.fn().mockResolvedValue();
  vi.doMock('../lib/onboardingSave', () => ({ saveOnboardingPlaces: save }));
  const { default: OnboardingPlaces } = await import('./OnboardingPlaces.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  const onDone = vi.fn();
  await act(async () => createRoot(container).render(<OnboardingPlaces onChange={() => {}} onDone={onDone} {...props} />));
  return { el: container, save, onDone };
}
const place = { regionId: 'miami', id: 'x', name: 'Cafe X', categories: ['food'] };
const next = (el) => el.querySelector('.btn-primary');

describe('OnboardingPlaces', () => {
  it('asks for up to 10 places', async () => {
    const { el } = await render({ places: [] });
    expect(el.textContent).toContain('Tell us up to 10 places you visit most');
  });

  it('with an account, Continue saves the places for Mapr, then moves on', async () => {
    const { el, save, onDone } = await render({ places: [place], uid: 'u1', profile: { a: 1 } });
    await act(async () => next(el).click());
    expect(save).toHaveBeenCalledWith('u1', { a: 1 }, [place]);
    expect(onDone).toHaveBeenCalled();
  });

  it('without an account (Test tab) nothing is saved', async () => {
    const { el, save, onDone } = await render({ places: [place] });
    await act(async () => next(el).click());
    expect(save).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it('stays on the step and shows an error when the save fails', async () => {
    const { el, save, onDone } = await render({ places: [place], uid: 'u1' });
    save.mockRejectedValue(new Error('offline'));
    await act(async () => next(el).click());
    expect(onDone).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
  });
});
