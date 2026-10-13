// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import MaprTutorial from './MaprTutorial';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let el;
afterEach(() => {
  act(() => root.unmount());
  el.remove();
  vi.useRealTimers();
});
const button = (text) => [...el.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const press = (label) => act(async () => el.querySelector(`[aria-label="${label}"]`).click());

describe('MaprTutorial', () => {
  it('Mapr says hello, then has you practice each answer with a good job', async () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => root.render(<MaprTutorial onDone={onDone} />));
    expect(el.textContent).toContain("Hello! I'm Mapr, your personal AI assistant.");

    await act(async () => button("Let's practice").click());
    expect(el.textContent).toContain('swipe right');
    expect(el.textContent).toContain('Ice cream');

    await press("Don't like it");
    await act(async () => vi.advanceTimersByTime(300));
    expect(el.textContent).toContain('Almost!');

    await press('Love it');
    await act(async () => vi.advanceTimersByTime(300));
    expect(el.textContent).toContain('Good job!');
    await act(async () => vi.advanceTimersByTime(1000));
    expect(el.textContent).toContain('Traffic jams');

    await press("Don't like it");
    await act(async () => vi.advanceTimersByTime(1300));
    expect(el.textContent).toContain('Opera');

    await press('Not sure');
    await act(async () => vi.advanceTimersByTime(1300));
    expect(el.textContent).toContain("You've got it!");
    await act(async () => button('Start').click());
    expect(onDone).toHaveBeenCalled();
  });
});
