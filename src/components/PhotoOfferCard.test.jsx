// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ share: vi.fn(), decline: vi.fn(), show: vi.fn(), claim: vi.fn() }));
vi.mock('../lib/communityPhotos', () => ({ shareCommunityPhoto: h.share, rememberPhotoOfferDeclined: h.decline, claimCommunityPhotoBonus: h.claim, COMMUNITY_PHOTO_BONUS: 10 }));
vi.mock('../lib/ToastContext', () => ({ useToast: () => ({ show: h.show }) }));
vi.mock('../lib/placePhoto', () => ({ primePlacePhoto: vi.fn() }));

import PhotoOfferCard from './PhotoOfferCard';

let container;
afterEach(() => container?.remove());
const lm = { id: 'pl-1', name: 'Cafe A', lat: 1, lng: 2 };

async function render(onDone, onTakeAnother) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(<PhotoOfferCard landmark={lm} regionId="miami" uid="ann" photoUrl="https://x/p.jpg" onDone={onDone} onTakeAnother={onTakeAnother} />)
  );
}
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label));

describe('PhotoOfferCard', () => {
  it('Yes shares the photo and reports it won', async () => {
    h.share.mockResolvedValue(true);
    const onDone = vi.fn();
    await render(onDone);
    expect(container.textContent).toContain('Can we use your photo');
    await act(async () => button('Yes').click());
    expect(h.share).toHaveBeenCalledWith({ region: 'miami', id: 'pl-1', url: 'https://x/p.jpg', uid: 'ann' });
    expect(onDone).toHaveBeenCalledWith(true);
  });

  it('No saves nothing and remembers the answer, so the next person is asked', async () => {
    h.share.mockClear();
    const onDone = vi.fn();
    await render(onDone);
    await act(async () => button('No thanks').click());
    expect(h.share).not.toHaveBeenCalled();
    expect(h.decline).toHaveBeenCalledWith('ann', 'miami', 'pl-1');
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it('losing the race to someone else says so and closes', async () => {
    h.share.mockResolvedValue(false);
    const onDone = vi.fn();
    await render(onDone);
    await act(async () => button('Yes').click());
    expect(onDone).toHaveBeenCalledWith(false);
    expect(h.show).toHaveBeenCalledWith(expect.stringContaining('just before you'), expect.anything());
  });

  it('No thanks offers another picture for 10 extra points; a second No ends it', async () => {
    h.decline.mockClear();
    const onDone = vi.fn();
    await render(onDone, vi.fn());
    await act(async () => button('No thanks').click());
    expect(h.decline).not.toHaveBeenCalled();
    expect(container.textContent).toContain('without your face');
    expect(container.textContent).toContain('10 extra points');
    await act(async () => button('No thanks').click());
    expect(h.decline).toHaveBeenCalledWith('ann', 'miami', 'pl-1');
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it('taking another picture shares it, claims the +10 and tells them', async () => {
    h.share.mockReset().mockResolvedValue(true);
    h.claim.mockReset().mockResolvedValue({ awarded: 10 });
    h.show.mockClear();
    const onDone = vi.fn();
    const take = vi.fn().mockResolvedValue('https://x/new.jpg');
    await render(onDone, take);
    await act(async () => button('No thanks').click());
    await act(async () => button('take another picture').click());
    expect(h.share).toHaveBeenCalledWith({ region: 'miami', id: 'pl-1', url: 'https://x/new.jpg', uid: 'ann' });
    expect(h.claim).toHaveBeenCalledWith({ region: 'miami', id: 'pl-1', url: 'https://x/new.jpg' });
    expect(h.show).toHaveBeenCalledWith(expect.stringContaining('+10 points'), expect.anything());
    expect(onDone).toHaveBeenCalledWith(true);
  });

  it('closing the camera changes nothing', async () => {
    h.share.mockReset();
    const onDone = vi.fn();
    await render(onDone, vi.fn().mockResolvedValue(null));
    await act(async () => button('No thanks').click());
    await act(async () => button('take another picture').click());
    expect(h.share).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
