// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchTips: vi.fn(),
  reactToTip: vi.fn(),
  reportTip: vi.fn(),
  deleteMyTip: vi.fn(),
  editMyTip: vi.fn(),
  postTip: vi.fn(),
  uploadTipPhoto: vi.fn(),
  discardTipPhoto: vi.fn(async () => ({ ok: true })),
  markTipsSeen: vi.fn(async () => ({ ok: true })),
  TIPS_CHANGED_EVENT: 'lh-tips-changed',
}));
const blocks = vi.hoisted(() => ({ blockUser: vi.fn(async () => {}) }));
const checkin = vi.hoisted(() => ({ value: null }));
vi.mock('../../lib/tipsApi', () => api);
vi.mock('../../lib/blocks', () => blocks);
vi.mock('../../lib/tipCheckin', () => ({ findTipCheckin: async () => checkin.value }));
vi.mock('../../lib/imageUtils', () => ({ pickPhoto: vi.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import TipsSection from './TipsSection';

const landmark = { id: 'bell', regionId: 'philly', name: 'Liberty Bell' };
const user = { uid: 'me', emailVerified: true };
const tip = (o) => ({ id: 'ann_bell', authorUid: 'ann', authorName: 'ann', text: 'Go early, the line wraps.', tags: ['go-early'], photoURL: null, visitMonth: '2026-10', verified: true, counts: { helpful: 2, saved: 0 }, mine: false, ...o });

let container;
const toast = { show: vi.fn() };
async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<TipsSection landmark={landmark} user={user} toast={toast} />));
  await act(async () => {});
}
const buttons = () => [...container.querySelectorAll('button')];
const click = async (label) => {
  const b = buttons().find((x) => x.textContent.includes(label));
  if (!b) throw new Error(`no button ${label}`);
  await act(async () => b.click());
};

beforeEach(() => {
  vi.clearAllMocks();
  checkin.value = null;
  api.fetchTips.mockResolvedValue({ tips: [tip()], reactions: {} });
  window.confirm = () => true;
});
afterEach(() => document.body.removeChild(container));

describe('TipsSection', () => {
  it('shows "From people who went" with the finder, Verified visit, the month and tags, and records it as seen', async () => {
    await mount();
    expect(container.textContent).toContain('From people who went');
    expect(container.textContent).toContain('ann');
    expect(container.textContent).toContain('Verified visit');
    expect(container.textContent).toContain('2026');
    expect(container.textContent).toContain('Go early');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
    expect(api.markTipsSeen).toHaveBeenCalledTimes(1);
    expect(api.markTipsSeen).toHaveBeenCalledWith(['ann_bell']);
  });
  it('drops a tip from the list when the server says it is no longer public', async () => {
    api.reactToTip.mockResolvedValue({ ok: true, reaction: { helpful: false, saved: false }, counts: null });
    await mount();
    await click('Helpful');
    expect(container.textContent).not.toContain('Go early');
  });
  it('marks a tip helpful and shows the new count, never who', async () => {
    api.reactToTip.mockResolvedValue({ ok: true, reaction: { helpful: true, saved: false }, counts: { helpful: 3, saved: 0 } });
    await mount();
    await click('Helpful');
    expect(api.reactToTip).toHaveBeenCalledWith('ann_bell', 'helpful', true);
    expect(buttons().find((b) => b.textContent.includes('Helpful')).textContent).toContain('3');
  });
  it('reports with a reason and hides the tip for the reporter', async () => {
    api.reportTip.mockResolvedValue({ ok: true });
    await mount();
    await click('Report');
    await click('Offensive or hateful');
    expect(api.reportTip).toHaveBeenCalledWith('ann_bell', 'offensive');
    expect(container.textContent).not.toContain('Go early');
  });
  it('blocks the author and hides their tips', async () => {
    await mount();
    await click('Block');
    expect(blocks.blockUser).toHaveBeenCalledWith('me', 'ann', 'ann');
    expect(container.textContent).not.toContain('Go early');
  });
  it('shows your own held tip with its status and a Delete button', async () => {
    api.fetchTips.mockResolvedValue({ tips: [tip({ id: 'me_bell', authorUid: 'me', mine: true, status: 'held', hidden: false })], reactions: {} });
    await mount();
    expect(container.textContent).toContain('Your tip');
    expect(container.textContent).toContain('waiting for review');
    expect(buttons().some((b) => b.textContent === 'Report')).toBe(false);
    api.deleteMyTip.mockResolvedValue({ ok: true });
    await click('Delete');
    expect(api.deleteMyTip).toHaveBeenCalledWith('bell', 'philly');
  });
  it('edits your own tip in place: the form opens filled in and saves through the server', async () => {
    api.fetchTips.mockResolvedValue({ tips: [tip({ id: 'me_bell', authorUid: 'me', mine: true, status: 'live', hidden: false, edited: true })], reactions: {} });
    await mount();
    expect(container.textContent).toContain('edited');
    await click('Edit');
    const box = container.querySelector('textarea');
    expect(box.value).toBe('Go early, the line wraps.');
    expect(container.textContent).not.toContain('Add a photo');
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    await act(async () => {
      set.call(box, 'Go early, before the school groups.');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    api.editMyTip.mockResolvedValue({ ok: true, status: 'live' });
    await click('Save changes');
    expect(api.editMyTip).toHaveBeenCalledWith({ landmarkId: 'bell', region: 'philly', text: 'Go early, before the school groups.', tags: ['go-early'] });
  });
  it('offers "Share a tip" only with a verified check-in and no tip of yours yet', async () => {
    await mount();
    expect(container.textContent).not.toContain('Share a tip for others');
    document.body.removeChild(container);
    checkin.value = { id: 'me_bell', at: 1 };
    await mount();
    await click('Share a tip for others');
    expect(container.textContent).toContain('Tips are public and show your username');
  });
});
