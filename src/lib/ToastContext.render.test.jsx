// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, memo } from 'react';
import { ToastProvider, useToast } from './ToastContext.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('ToastProvider', () => {
  it('showing a toast does not re-render useToast consumers', async () => {
    let renders = 0;
    let toast;
    const Consumer = memo(function Consumer() {
      toast = useToast();
      renders += 1;
      return null;
    });
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(<ToastProvider><Consumer /></ToastProvider>));
    expect(renders).toBe(1);
    await act(async () => {
      toast.show('hello', { durationMs: 0 });
    });
    expect(host.textContent).toContain('hello');
    expect(renders).toBe(1);
    root.unmount();
  });
});
