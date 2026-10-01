// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from './ErrorBoundary';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let host;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

function Bomb() {
  throw new Error('kaboom');
}

function mountCrash() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )
  );
}

describe('ErrorBoundary', () => {
  it('shows the recovery buttons and does not reload on its own', () => {
    mountCrash();
    expect(host.textContent).toContain('Something went wrong');
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toContain('Try Again');
    expect(host.textContent).toContain('kaboom');
  });

  it('with a fallback, a crashing piece of chrome drops out while its siblings stay', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root.render(
        <div>
          <ErrorBoundary fallback={null}>
            <Bomb />
          </ErrorBoundary>
          <p>still here</p>
        </div>
      )
    );
    expect(host.textContent).toBe('still here');
  });

  it('says so when the device is offline', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    mountCrash();
    expect(host.textContent).toMatch(/offline/i);
  });

  it('Back to Map still does something when the crashed screen is the map itself', () => {
    mountCrash();
    window.location.hash = '#/';
    const link = host.querySelector('a');
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    // jsdom can't reload; the point is the default (a no-op hash change) is cancelled.
    act(() => {
      link.dispatchEvent(evt);
    });
    expect(evt.defaultPrevented).toBe(true);
  });

  it('lets Back to Map navigate normally from any other screen', () => {
    mountCrash();
    window.location.hash = '#/settings';
    const link = host.querySelector('a');
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(evt);
    });
    expect(evt.defaultPrevented).toBe(false);
  });
});
