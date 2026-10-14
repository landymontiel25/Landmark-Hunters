import { describe, expect, it, vi } from 'vitest';
import { goBack } from './goBack';

describe('goBack', () => {
  it('steps back when the app has a page to go back to', () => {
    const navigate = vi.fn();
    goBack(navigate, { key: 'abc123' }, '/landmarks');
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  // Found by the app simulation: a landmark page opened from a shared link
  // is the first page, and navigate(-1) did nothing or left the app.
  it('goes to the fallback when the page was opened straight from a link', () => {
    const navigate = vi.fn();
    goBack(navigate, { key: 'default' }, '/landmarks');
    expect(navigate).toHaveBeenCalledWith('/landmarks', { replace: true });
  });

  it('falls back to the Map by default', () => {
    const navigate = vi.fn();
    goBack(navigate, { key: 'default' });
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });
});
