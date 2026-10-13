// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' } }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ friendUids: new Set(), myUsername: 'me' }) }));
vi.mock('../lib/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('../lib/friends', () => ({
  getUserProfile: vi.fn(async () => ({ uid: 'x', username: 'other' })),
  sendFriendRequest: vi.fn(async () => {}),
  hasPendingRequestTo: vi.fn(async () => false),
}));
vi.mock('./FollowButton', () => ({ default: () => null }));
vi.mock('./FriendStatsModal', () => ({ default: () => null }));

import FriendPopoverName from './FriendPopoverName';

let container;
let root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

const mount = async () => {
  root = createRoot(container);
  await act(async () => root.render(<FriendPopoverName userId="x" fallbackName="Other">Other</FriendPopoverName>));
};
const trigger = () => container.querySelector('.user-popover-trigger');
const card = () => container.querySelector('.user-popover-card');

// What the browser sends for a pointer arriving over the name. React's
// onPointerEnter/onMouseEnter listen for the "over" events.
function enter(el, pointerType) {
  const pe = new MouseEvent('pointerover', { bubbles: true });
  Object.defineProperty(pe, 'pointerType', { value: pointerType });
  el.dispatchEvent(pe);
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}

describe('FriendPopoverName', () => {
  // Found by the app simulation: on a phone a tap's own enter event opened
  // the card and the tap's click closed it, so tapping a name did nothing.
  it('a tap on a phone opens the card', async () => {
    await mount();
    await act(async () => {
      enter(trigger(), 'touch');
      trigger().click();
    });
    expect(card()).not.toBeNull();
  });

  it('a mouse hover opens it and a click closes it', async () => {
    await mount();
    await act(async () => enter(trigger(), 'mouse'));
    expect(card()).not.toBeNull();
    await act(async () => trigger().click());
    expect(card()).toBeNull();
  });
});
