// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ProfileList from './ProfileList';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('ProfileList', () => {
  it('renders one tappable row per item, with detail and a chevron', async () => {
    const open = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(<ProfileList label="Sections" items={[{ id: 'a', icon: 'stats', label: 'Your Stats', detail: '42 check-ins', onClick: open }, { id: 'b', icon: 'signout', label: 'Sign Out', disabled: true, onClick: open }]} />);
    });
    const rows = el.querySelectorAll('.pf-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Your Stats');
    expect(rows[0].querySelector('.pf-row-detail').textContent).toBe('42 check-ins');
    expect(rows[0].querySelector('.pf-row-chevron')).toBeTruthy();
    await act(async () => rows[0].click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(rows[1].disabled).toBe(true);
    await act(async () => root.unmount());
  });
});
