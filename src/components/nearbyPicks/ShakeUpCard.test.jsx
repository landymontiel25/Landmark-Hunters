// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ShakeUpCard from './ShakeUpCard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host;
let root;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (el) => act(() => root.render(el));

describe('ShakeUpCard', () => {
  it('shows only for a stagnating user', () => {
    render(<ShakeUpCard uid="u1" show={false} onShake={() => {}} />);
    expect(host.textContent).toBe('');
    render(<ShakeUpCard uid="u1" show onShake={() => {}} />);
    expect(host.textContent).toContain('Shake things up?');
  });

  it('builds a new set and hides for the day', () => {
    const onShake = vi.fn();
    render(<ShakeUpCard uid="u1" show onShake={onShake} />);
    act(() => host.querySelector('.mpp-shake-btn').click());
    expect(onShake).toHaveBeenCalledOnce();
    expect(host.textContent).toBe('');
    act(() => root.unmount());
    root = createRoot(host);
    render(<ShakeUpCard uid="u1" show onShake={onShake} />);
    expect(host.textContent).toBe('');
  });

  it('"Not now" hides it without a new set', () => {
    const onShake = vi.fn();
    render(<ShakeUpCard uid="u2" show onShake={onShake} />);
    act(() => host.querySelector('.mpp-shake-dismiss').click());
    expect(onShake).not.toHaveBeenCalled();
    expect(host.textContent).toBe('');
  });
});
