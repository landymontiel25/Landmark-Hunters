// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const previewDisagreement = vi.fn();
vi.mock('../lib/reviews', () => ({ previewDisagreement: (...a) => previewDisagreement(...a) }));

import DisagreementPrompt from './DisagreementPrompt';
import { useDisagreementAsk } from '../lib/useDisagreementAsk';

const mounted = [];
afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    try {
      await act(async () => root.unmount());
    } catch {
      /* already unmounted by the test */
    }
    container.remove();
  }
  document.body.innerHTML = '';
});
const mount = async (el) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(el));
  return { container, root };
};
const btn = (text) => [...document.body.querySelectorAll('button')].find((b) => b.textContent === text);
const setNote = async (text) => {
  const ta = document.body.querySelector('textarea');
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => {
    set.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('DisagreementPrompt', () => {
  it('is an accessible dialog that asks once, with every answer as a button', async () => {
    const onAnswer = vi.fn();
    await mount(<DisagreementPrompt landmarkName="Cafe" onAnswer={onAnswer} />);
    const dlg = document.body.querySelector('[role="dialog"]');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dlg.getAttribute('aria-labelledby')).textContent).toBe('Your answer changed a lot. What happened?');
    for (const label of ['Food', 'Service', 'Price', 'Noise or crowd', 'I changed my mind', 'First visit was a one-off', 'I was wrong about this type of place', 'Other', 'Skip']) {
      expect(btn(label), label).toBeTruthy();
    }
    expect(document.body.querySelector('textarea').maxLength).toBe(500);
    expect(document.activeElement).toBe(btn('Food')); // focus moves into the dialog
  });

  it.each([
    ['Food', 'food'],
    ['Service', 'service'],
    ['Price', 'price'],
    ['Noise or crowd', 'noise-crowd'],
    ['I changed my mind', 'changed-mind'],
    ['First visit was a one-off', 'one-off'],
    ['I was wrong about this type of place', 'wrong-type'],
    ['Other', 'other'],
  ])('%s answers %s, with the note', async (label, reason) => {
    const onAnswer = vi.fn();
    await mount(<DisagreementPrompt onAnswer={onAnswer} />);
    await setNote('cold fries');
    await act(async () => btn(label).click());
    expect(onAnswer).toHaveBeenCalledWith({ reason, comment: 'cold fries' });
  });

  it('Skip and Escape both answer skip', async () => {
    const onAnswer = vi.fn();
    await mount(<DisagreementPrompt onAnswer={onAnswer} />);
    await act(async () => btn('Skip').click());
    expect(onAnswer).toHaveBeenLastCalledWith({ reason: 'skip', comment: '' });
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onAnswer).toHaveBeenLastCalledWith({ reason: 'skip', comment: '' });
  });
});

describe('useDisagreementAsk', () => {
  let result;
  function Probe() {
    result = useDisagreementAsk();
    return <div>{result.node}</div>;
  }
  const args = { userId: 'u', landmark: { id: 'a', name: 'Cafe' }, tier: 'probably-skip' };

  it('resolves undefined with no question when none is due, or the check fails', async () => {
    await mount(<Probe />);
    previewDisagreement.mockResolvedValueOnce({ needed: false, needsAsk: false });
    expect(await result.ask(args)).toBeUndefined();
    previewDisagreement.mockResolvedValueOnce({ needed: true, auto: 'price', needsAsk: false });
    expect(await result.ask(args)).toBeUndefined();
    previewDisagreement.mockRejectedValueOnce(new Error('offline'));
    expect(await result.ask(args)).toBeUndefined();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the modal and resolves with the answer', async () => {
    await mount(<Probe />);
    previewDisagreement.mockResolvedValueOnce({ needed: true, auto: null, needsAsk: true });
    let p;
    await act(async () => {
      p = result.ask(args);
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => btn('Price').click());
    expect(await p).toEqual({ reason: 'price', comment: '' });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('leaving the screen mid-question answers it as skip, so a save never hangs', async () => {
    const { root } = await mount(<Probe />);
    previewDisagreement.mockResolvedValueOnce({ needed: true, auto: null, needsAsk: true });
    let p;
    await act(async () => {
      p = result.ask(args);
    });
    await act(async () => root.unmount());
    expect(await p).toEqual({ reason: 'skip', comment: '' });
  });
});
