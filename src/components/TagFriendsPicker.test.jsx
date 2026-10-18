// @vitest-environment jsdom
// Owner, 2026-10-18: tag a friend when rating; they get a notification.
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/friends', () => ({
  listFriends: async () => [
    { owner: 'me', friend: 'ann', friendName: 'ann' },
    { owner: 'me', friend: 'bo', friendName: 'bo' },
  ],
}));
const notify = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../lib/notifications', () => ({ notifyUser: (...a) => notify(...a) }));

const { default: TagFriendsPicker } = await import('./TagFriendsPicker');

describe('TagFriendsPicker', () => {
  it('the @ button lists your friends, and tapping one tags them', async () => {
    const onChange = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<TagFriendsPicker uid="me" tagged={[{ uid: 'bo', name: 'bo' }]} onChange={onChange} />));
    await act(async () => el.querySelector('button').click());
    await act(async () => {});
    const options = [...el.querySelectorAll('.tag-friends-option')].map((b) => b.textContent);
    expect(options).toEqual(['@ann']);
    await act(async () => el.querySelector('.tag-friends-option').click());
    expect(onChange).toHaveBeenCalledWith([{ uid: 'bo', name: 'bo' }, { uid: 'ann', name: 'ann' }], { added: { uid: 'ann', name: 'ann' } });
    act(() => root.unmount());
    el.remove();
  });
});

describe('notifyTaggedFriends', () => {
  it('notifies each tagged friend once, never yourself', async () => {
    const { notifyTaggedFriends } = await import('../lib/reviews');
    await notifyTaggedFriends({
      userId: 'me',
      userName: 'tia',
      landmark: { id: 'vizcaya', regionId: 'miami', name: 'Vizcaya' },
      tagged: [{ uid: 'ann', name: 'ann' }, { uid: 'ann', name: 'ann' }, { uid: 'me', name: 'tia' }],
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('ann', {
      type: 'rating_tag',
      message: '@tia tagged you in their rating of Vizcaya.',
      landmarkId: 'vizcaya',
      regionId: 'miami',
      fromUid: 'me',
    });
  });
});
