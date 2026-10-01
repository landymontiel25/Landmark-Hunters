// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Legal from './Legal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
afterEach(() => document.body.removeChild(container));

describe('Legal back button', () => {
  it('goes home when the page was opened directly (no history)', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () =>
      createRoot(container).render(
        <MemoryRouter initialEntries={['/legal']}>
          <Routes>
            <Route path="/legal" element={<Legal />} />
            <Route path="/" element={<p>home screen</p>} />
          </Routes>
        </MemoryRouter>
      )
    );
    await act(async () => container.querySelector('button').click());
    expect(container.textContent).toContain('home screen');
  });
});
