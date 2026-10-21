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

// Drag the practice card dx pixels (0 = a tap on the card).
const drag = async (dx) => {
  const card = el.querySelector('.lab-card');
  const fire = (type, x) => card.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 0 }));
  await act(async () => {
    fire('pointerdown', 100);
    fire('pointermove', 100 + dx);
    fire('pointerup', 100 + dx);
  });
  await act(async () => vi.advanceTimersByTime(300));
};

describe('MaprTutorial', () => {
  it('has you swipe right, swipe left, tap the card, then tap a button, saying what each means', async () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => root.render(<MaprTutorial onDone={onDone} />));
    expect(el.textContent).toContain("Let's practice first");

    await act(async () => button("Let's practice").click());
    expect(el.textContent).toContain('Swipe the Ice cream card right.');
    expect(el.querySelector('.mapr-dir-right').textContent).toBe('right');
    expect(el.querySelector('.mapr-bubble-ask .mapr-bubble-text').textContent).toBe('Swipe the Ice cream card right.');

    // Wrong answer, then right answer the wrong way (the button, not a swipe).
    await drag(-200);
    expect(el.textContent).toContain('Almost! That was a nope.');
    await press('Love it');
    await act(async () => vi.advanceTimersByTime(300));
    expect(el.textContent).toContain('Right answer, but that was a button.');
    // "Right answer" means correct, so it stays plain; only the direction is green.
    expect([...el.querySelectorAll('.mapr-dir')].map((n) => n.textContent)).toEqual(['right']);

    await drag(200);
    // Straight on to the next card, Ice cream gone, praise above it.
    expect(el.textContent).toContain('Swiping right means you loved it.');
    expect(el.textContent).not.toContain('Ice cream');
    expect(el.textContent).toContain('Traffic jams');
    expect(el.querySelector('.mapr-dir-left').textContent).toBe('left');

    await drag(-200);
    expect(el.textContent).toContain("Swiping left means you didn't like it.");
    expect(el.textContent).not.toContain('Traffic jams');
    expect(el.textContent).toContain('Opera');

    await drag(0);
    expect(el.textContent).toContain("Tapping the card means you're not sure.");
    expect(el.textContent).toContain('Beaches');

    await press('Love it');
    await act(async () => vi.advanceTimersByTime(300));
    expect(el.textContent).toContain('same as swiping right');

    expect(el.textContent).toContain("You've got it!");
    await act(async () => button('Start').click());
    expect(onDone).toHaveBeenCalled();
  });
});
