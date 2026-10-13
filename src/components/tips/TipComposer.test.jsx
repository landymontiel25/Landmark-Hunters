// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';

const api = vi.hoisted(() => ({ postTip: vi.fn(), uploadTipPhoto: vi.fn(), discardTipPhoto: vi.fn(async () => ({ ok: true })), TIPS_CHANGED_EVENT: 'lh-tips-changed' }));
const photo = vi.hoisted(() => ({ pickPhoto: vi.fn() }));
vi.mock('../../lib/tipsApi', () => api);
vi.mock('../../lib/imageUtils', () => photo);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import TipComposer from './TipComposer';

let container;
afterEach(() => document.body.removeChild(container));
async function mount(props = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<TipComposer uid="me" checkinId="me_bell" landmarkName="Liberty Bell" {...props} />));
}
const type = async (text) => {
  const ta = container.querySelector('textarea');
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => {
    set.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const share = () => [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Share tip'));

describe('TipComposer', () => {
  it('needs 10 characters, then posts the tip with up to 3 tags', async () => {
    const onPosted = vi.fn();
    api.postTip.mockResolvedValue({ ok: true, status: 'live' });
    await mount({ onPosted });
    await type('short');
    expect(share().disabled).toBe(true);
    await type('Go early, the line wraps.');
    const chips = [...container.querySelectorAll('.chip')];
    for (const c of chips.slice(0, 4)) await act(async () => c.click());
    expect(container.querySelectorAll('.chip.selected')).toHaveLength(3);
    await act(async () => share().click());
    expect(api.postTip).toHaveBeenCalledWith({ checkinId: 'me_bell', text: 'Go early, the line wraps.', tags: ['go-early', 'quiet', 'busy'], photoURL: null });
    expect(onPosted).toHaveBeenCalledWith({ ok: true, status: 'live' });
  });
  it("shows the server's reason and discards an uploaded photo when the post is refused", async () => {
    photo.pickPhoto.mockResolvedValue(new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' }));
    globalThis.URL.createObjectURL = () => 'blob:x';
    globalThis.URL.revokeObjectURL = () => {};
    api.uploadTipPhoto.mockResolvedValue('https://firebasestorage.googleapis.com/v0/b/b/o/tip_photos%2Fme%2Fp.jpg');
    api.postTip.mockRejectedValue(Object.assign(new Error('x'), { userMessage: 'That is a lot of tips in one hour. Try again later.' }));
    await mount();
    await type('Go early, the line wraps.');
    await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Add a photo')).click());
    await act(async () => share().click());
    expect(container.textContent).toContain('a lot of tips in one hour');
    expect(api.discardTipPhoto).toHaveBeenCalledWith('https://firebasestorage.googleapis.com/v0/b/b/o/tip_photos%2Fme%2Fp.jpg');
  });
});
