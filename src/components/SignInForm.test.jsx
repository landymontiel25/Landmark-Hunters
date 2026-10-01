// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  vi.resetModules();
});

async function renderForm(signInEmail) {
  vi.doMock('../lib/AuthContext', () => ({
    useAuth: () => ({ signInEmail, signUpEmail: vi.fn(), signInWithGoogle: vi.fn(), resetPassword: vi.fn() }),
  }));
  const { default: SignInForm } = await import('./SignInForm.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MemoryRouter>
        <SignInForm />
      </MemoryRouter>
    );
  });
}

const buttonWith = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text));

describe('SignInForm mode switch', () => {
  it('retitles the screen and drops a stale sign-in error when switching to Create Account', async () => {
    await renderForm(vi.fn().mockRejectedValue({ code: 'auth/wrong-password' }));
    expect(container.querySelector('h1').textContent).toContain('Sign In');

    await act(async () => {
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain("doesn't match");

    await act(async () => buttonWith('Create an Account').click());
    expect(container.querySelector('h1').textContent).toContain('Create Account');
    expect(container.textContent).not.toContain("doesn't match");
  });
});
