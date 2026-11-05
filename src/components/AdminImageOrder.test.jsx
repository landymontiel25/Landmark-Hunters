// @vitest-environment jsdom
// Owner ask 2026-11-05: in Admin Mode, edit the order of a landmark's photos.
import { describe, it, expect, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'admin' } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));
vi.mock('./CategorySelect', () => ({ default: () => null }));
const saveLandmarkEdit = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../lib/landmarkOverrides', () => ({ saveLandmarkEdit, clearLandmarkEdit: vi.fn() }));
const updateCustomLandmark = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../lib/customLandmarks', () => ({ updateCustomLandmark, deleteCustomLandmark: vi.fn() }));

import AdminImageOrder from './AdminImageOrder';
import { moveImage } from '../lib/moveImage';
import AdminEditBuiltInPanel from './AdminEditBuiltInPanel';
import AdminEditLandmarkPanel from './AdminEditLandmarkPanel';

const A = 'https://example.com/a.jpg';
const B = 'https://example.com/b.jpg';
const C = 'https://example.com/c.jpg';

async function mount(node) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return container;
}
const button = (container, label) => container.querySelector(`button[aria-label="${label}"]`);
const saveButton = (container) => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save Changes');

describe('moveImage', () => {
  it('moves a photo up, down and ignores moves off either end', () => {
    expect(moveImage([A, B, C], 2, 0)).toEqual([C, A, B]);
    expect(moveImage([A, B, C], 0, 1)).toEqual([B, A, C]);
    expect(moveImage([A, B, C], 0, -1)).toEqual([A, B, C]);
    expect(moveImage([A, B, C], 2, 3)).toEqual([A, B, C]);
    expect(moveImage([A, B, C], 1, 1)).toEqual([A, B, C]);
  });

  it('does not change the list it was given', () => {
    const list = [A, B, C];
    moveImage(list, 0, 2);
    expect(list).toEqual([A, B, C]);
  });
});

describe('AdminImageOrder', () => {
  it('shows nothing for a landmark with one photo or none', async () => {
    expect((await mount(<AdminImageOrder images={[A]} onChange={() => {}} />)).children.length).toBe(0);
    expect((await mount(<AdminImageOrder images={[]} onChange={() => {}} />)).children.length).toBe(0);
  });

  it('disables Up on the cover and Down on the last photo', async () => {
    const c = await mount(<AdminImageOrder images={[A, B, C]} onChange={() => {}} />);
    expect(button(c, 'Move photo 1 up').disabled).toBe(true);
    expect(button(c, 'Move photo 3 down').disabled).toBe(true);
    expect(button(c, 'Move photo 2 up').disabled).toBe(false);
    expect(c.textContent).toContain('Cover');
  });

  it('reports the new order when a photo moves up', async () => {
    const onChange = vi.fn();
    const c = await mount(<AdminImageOrder images={[A, B, C]} onChange={onChange} />);
    await act(async () => {
      button(c, 'Move photo 3 up').click();
    });
    expect(onChange).toHaveBeenCalledWith([A, C, B]);
  });
});

describe('Admin edit panels save the new photo order', () => {
  it('built-in landmark: Save writes the reordered gallery', async () => {
    saveLandmarkEdit.mockClear();
    const landmark = { id: 'x', region: 'philly', name: 'X', categories: ['food'], images: [A, B, C], free: true };
    const c = await mount(<AdminEditBuiltInPanel landmark={landmark} onSaved={() => {}} />);
    await act(async () => {
      button(c, 'Move photo 3 up').click();
    });
    await act(async () => {
      button(c, 'Move photo 2 up').click();
    });
    await act(async () => {
      saveButton(c).click();
    });
    expect(saveLandmarkEdit).toHaveBeenCalledTimes(1);
    expect(saveLandmarkEdit.mock.calls[0][0].fields.images).toEqual([C, A, B]);
  });

  it('custom landmark: Save writes the reordered gallery', async () => {
    updateCustomLandmark.mockClear();
    const landmark = { id: 'custom_1', docId: 'd1', name: 'X', categories: ['food'], images: [A, B], free: true };
    const c = await mount(<AdminEditLandmarkPanel landmark={landmark} />);
    await act(async () => {
      button(c, 'Move photo 2 up').click();
    });
    await act(async () => {
      saveButton(c).click();
    });
    expect(updateCustomLandmark).toHaveBeenCalledTimes(1);
    expect(updateCustomLandmark.mock.calls[0][1].images).toEqual([B, A]);
  });

  it('editing the Photo URL still changes only the cover', async () => {
    saveLandmarkEdit.mockClear();
    const landmark = { id: 'x', region: 'philly', name: 'X', categories: ['food'], images: [A, B], free: true };
    const c = await mount(<AdminEditBuiltInPanel landmark={landmark} onSaved={() => {}} />);
    const input = c.querySelector('input[aria-label="Image URL"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    await act(async () => {
      setter.call(input, ' https://example.com/new.jpg ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      saveButton(c).click();
    });
    expect(saveLandmarkEdit.mock.calls[0][0].fields.images).toEqual(['https://example.com/new.jpg', B]);
  });
});
