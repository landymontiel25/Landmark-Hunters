// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import RatingFlow from './RatingFlow';
import { ASPECT_SETS, RATEABLE_CATEGORIES } from '../lib/ratingFlow';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => container?.remove());
const click = (el) => act(async () => el.click());

async function render(category) {
  const calls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(<RatingFlow landmark={{ id: 'x', name: 'X', categories: [category] }} onChange={(v) => calls.push(v)} />)
  );
  await click([...container.querySelectorAll('.rating-tier')].find((b) => b.textContent.includes('I loved it')));
  return { el: container, last: () => calls[calls.length - 1] };
}

describe('RatingFlow ranked aspects', () => {
  it.each(RATEABLE_CATEGORIES)('lets all four aspects be tapped and ranked 1 to 4 (%s)', async (category) => {
    const { el, last } = await render(category);
    const loved = [...el.querySelectorAll('.rating-flow-label')].find((p) => p.textContent.includes('tap in order')).parentElement;
    expect(loved.textContent).toContain('tap in order, up to 4');
    const buttons = () => [...loved.querySelectorAll('.rating-aspect')];
    expect(buttons()).toHaveLength(ASPECT_SETS[category].length);
    for (let i = 0; i < 4; i++) {
      expect(buttons()[i].disabled).toBe(false);
      await click(buttons()[i]);
    }
    expect(buttons().map((b) => b.querySelector('.rating-aspect-rank').textContent)).toEqual(['1', '2', '3', '4']);
    expect(buttons().every((b) => !b.disabled)).toBe(true);
    expect(last().lovedOrder).toHaveLength(4);
  });
});
