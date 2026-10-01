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

async function render(category, tierLabel = 'I loved it') {
  const calls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(<RatingFlow landmark={{ id: 'x', name: 'X', categories: [category] }} onChange={(v) => calls.push(v)} />)
  );
  await click([...container.querySelectorAll('.rating-tier')].find((b) => b.textContent.includes(tierLabel)));
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

// The "Ok" tier shows both lists (what made it great / what let it down) over
// the SAME four aspects: an aspect can sit in only one list, and each list
// still takes up to MAX_ASPECTS.
describe('RatingFlow ranked aspects on the Ok tier', () => {
  const lists = (el) => {
    const labels = [...el.querySelectorAll('.rating-flow-label')].filter((p) => p.textContent.includes('tap in order'));
    return labels.map((l) => l.parentElement);
  };
  const buttons = (list) => [...list.querySelectorAll('.rating-aspect')];
  const ranks = (list) => buttons(list).map((b) => b.querySelector('.rating-aspect-rank').textContent);

  it('shows both lists with four aspects each', async () => {
    const { el } = await render('food', 'Ok');
    const [great, letDown] = lists(el);
    expect(lists(el)).toHaveLength(2);
    expect(great.textContent).toContain('What made it great?');
    expect(letDown.textContent).toContain('What let it down?');
    expect(buttons(great)).toHaveLength(4);
    expect(buttons(letDown)).toHaveLength(4);
  });

  it.each(RATEABLE_CATEGORIES)('ranks all four aspects 1 to 4 in the great list (%s)', async (category) => {
    const { el, last } = await render(category, 'Ok');
    const [great, letDown] = lists(el);
    for (let i = 0; i < 4; i++) await click(buttons(great)[i]);
    expect(ranks(great)).toEqual(['1', '2', '3', '4']);
    expect(last().tier).toBe('worth-trying');
    expect(last().lovedOrder).toHaveLength(4);
    expect(last().dislikedOrder).toEqual([]);
    // Every aspect is now taken, so none can also go in the let-down list.
    expect(buttons(letDown).every((b) => b.disabled)).toBe(true);
  });

  it('keeps an aspect in one list only, and splits the four between the lists', async () => {
    const { el, last } = await render('food', 'Ok');
    const [great, letDown] = lists(el);
    await click(buttons(great)[0]); // Price -> great #1
    await click(buttons(great)[1]); // Location -> great #2
    // Price and Location are taken in the other list...
    expect(buttons(letDown)[0].disabled).toBe(true);
    expect(buttons(letDown)[1].disabled).toBe(true);
    // ...the two left are free, and rank 1 and 2 there.
    await click(buttons(letDown)[2]);
    await click(buttons(letDown)[3]);
    expect(ranks(letDown)).toEqual(['', '', '1', '2']);
    // ...and are now taken in the great list.
    expect(buttons(great)[2].disabled).toBe(true);
    expect(buttons(great)[3].disabled).toBe(true);
    const ids = [...last().lovedOrder, ...last().dislikedOrder];
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('frees an aspect for the other list when it is un-ranked', async () => {
    const { el, last } = await render('food', 'Ok');
    const [great, letDown] = lists(el);
    await click(buttons(great)[0]);
    expect(buttons(letDown)[0].disabled).toBe(true);
    await click(buttons(great)[0]); // tap again to un-rank
    expect(buttons(letDown)[0].disabled).toBe(false);
    await click(buttons(letDown)[0]);
    expect(last().dislikedOrder).toEqual([ASPECT_SETS.food[0].id]);
    expect(last().lovedOrder).toEqual([]);
  });

  it('only shows the matching list for the other two tiers', async () => {
    const loved = await render('food', 'I loved it');
    expect(lists(loved.el)).toHaveLength(1);
    expect(lists(loved.el)[0].textContent).toContain('What made it great?');
    loved.el.remove();
    const skip = await render('food', "I didn't like it");
    expect(lists(skip.el)).toHaveLength(1);
    expect(lists(skip.el)[0].textContent).toContain('What let it down?');
  });
});
