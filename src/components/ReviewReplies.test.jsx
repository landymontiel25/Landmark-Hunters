// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const getReplies = vi.fn();
const addReply = vi.fn();
vi.mock('../lib/reviews', () => ({
  getReplies: (...a) => getReplies(...a),
  addReply: (...a) => addReply(...a),
  deleteReply: vi.fn(),
}));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myUsername: 'me' }) }));
vi.mock('../lib/ToastContext', () => ({
  useToast: () => ({ show: vi.fn() }),
  runOptimistic: async ({ apply, commit }) => {
    apply();
    await commit();
  },
}));

import ReviewReplies from './ReviewReplies';

let container;
afterEach(() => document.body.removeChild(container));

describe('ReviewReplies', () => {
  it('a posted reply is not left faded/undeletable when the refresh fails', async () => {
    getReplies.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline'));
    addReply.mockResolvedValue('real1');
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () =>
      createRoot(container).render(<ReviewReplies reviewId="r1" currentUser={{ uid: 'me' }} reviewAuthorUid="x" />)
    );
    await act(async () => container.querySelector('button').click());
    const input = container.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    await act(async () => {
      setter.call(input, 'hello');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(container.textContent).toContain('hello');
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Delete')).toBe(true);
  });
});
