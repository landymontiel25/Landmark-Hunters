// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
afterEach(() => {
  container?.remove();
  document.body.innerHTML = '';
  vi.resetModules();
  vi.clearAllMocks();
});

async function renderSettings({ providers = ['password'], deleteAccount = vi.fn(async () => {}) } = {}) {
  const user = {
    uid: 'u1',
    email: 'a@b.co',
    emailVerified: true,
    providerData: providers.map((providerId) => ({ providerId })),
  };
  vi.doMock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}) }));
  vi.doMock('../lib/AuthContext', () => ({
    useAuth: () => ({
      user,
      firebaseEnabled: true,
      signOutUser: vi.fn(),
      resendVerification: vi.fn(),
      refreshUser: async () => {},
      changePassword: vi.fn(),
      deleteAccount,
    }),
  }));
  vi.doMock('../lib/FriendsContext', () => ({ useFriends: () => ({ myProfile: {}, reload: async () => {} }) }));
  vi.doMock('../lib/useTheme', () => ({ useTheme: () => ({ theme: 'dark', toggleTheme: () => {} }) }));
  vi.doMock('../lib/UnitsContext', () => ({
    useUnits: () => ({ units: 'imperial', mode: 'auto', setMode: () => {}, autoCountry: 'US' }),
    countryName: () => 'United States',
  }));
  vi.doMock('../lib/AdminModeContext', () => ({
    useAdminMode: () => ({ adminMode: false, canUseAdminMode: false, setAdminMode: () => {} }),
  }));
  vi.doMock('../lib/ToastContext', () => ({
    useToast: () => ({ show: vi.fn() }),
    runOptimistic: vi.fn(),
  }));
  vi.doMock('../components/LocationAutocomplete', () => ({ default: () => <div /> }));
  vi.doMock('../components/PreferenceChips', () => ({ default: () => <div /> }));

  const { default: Settings } = await import('./Settings.jsx');
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="/" element={<p>start screen</p>} />
        </Routes>
      </MemoryRouter>
    );
  });
  return { deleteAccount };
}

const byText = (txt) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === txt);

async function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function openModal() {
  await act(async () => byText('Delete Account').click());
}

describe('Settings > Delete Account', () => {
  it('keeps the confirm button disabled until DELETE and a password are typed', async () => {
    await renderSettings();
    await openModal();
    expect(byText('Delete My Account').disabled).toBe(true);
    await type(document.getElementById('delete-confirm'), 'delete');
    await type(document.getElementById('delete-password'), 'pw');
    expect(byText('Delete My Account').disabled).toBe(true);
    await type(document.getElementById('delete-confirm'), 'DELETE');
    expect(byText('Delete My Account').disabled).toBe(false);
    await type(document.getElementById('delete-password'), '');
    expect(byText('Delete My Account').disabled).toBe(true);
  });

  it('shows a friendly message, never the raw Firebase error, on a wrong password', async () => {
    const deleteAccount = vi.fn(async () => {
      throw Object.assign(new Error('Firebase: Error (auth/wrong-password).'), { code: 'auth/wrong-password' });
    });
    await renderSettings({ deleteAccount });
    await openModal();
    await type(document.getElementById('delete-confirm'), 'DELETE');
    await type(document.getElementById('delete-password'), 'nope');
    await act(async () => byText('Delete My Account').click());
    expect(deleteAccount).toHaveBeenCalledWith('nope');
    const alert = document.querySelector('[role="alert"]');
    expect(alert.textContent).toMatch(/password doesn't match/i);
    expect(document.body.textContent).not.toMatch(/Firebase: Error/);
    expect(document.body.textContent).not.toContain('start screen');
    expect(byText('Delete My Account').disabled).toBe(false);
  });

  it('deletes and goes to the start screen on success', async () => {
    const { deleteAccount } = await renderSettings();
    await openModal();
    await type(document.getElementById('delete-confirm'), 'DELETE');
    await type(document.getElementById('delete-password'), 'right');
    await act(async () => byText('Delete My Account').click());
    expect(deleteAccount).toHaveBeenCalledWith('right');
    expect(document.body.textContent).toContain('start screen');
  });

  it('Google-only accounts need no password field, just DELETE', async () => {
    const { deleteAccount } = await renderSettings({ providers: ['google.com'] });
    await openModal();
    expect(document.getElementById('delete-password')).toBeNull();
    await type(document.getElementById('delete-confirm'), 'DELETE');
    await act(async () => byText('Delete My Account').click());
    expect(deleteAccount).toHaveBeenCalledWith(undefined);
  });
});
