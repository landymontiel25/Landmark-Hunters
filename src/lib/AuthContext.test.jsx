// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
});

async function setup(authMock = {}, extra = {}) {
  const fb = { auth: { currentUser: null }, firebaseEnabled: true };
  let authCb = null;
  const calls = { sendEmailVerification: vi.fn(async () => {}), recordReferralIfPending: vi.fn(async () => {}) };
  vi.doMock('./firebase', () => fb);
  vi.doMock('firebase/auth', () => ({
    onAuthStateChanged: (_a, cb) => {
      authCb = cb;
      return () => {};
    },
    createUserWithEmailAndPassword: async () => ({ user: fb.auth.currentUser }),
    signInWithEmailAndPassword: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    sendEmailVerification: calls.sendEmailVerification,
    reload: vi.fn(async () => {}),
    updateProfile: vi.fn(async () => {}),
    signOut: vi.fn(),
    reauthenticateWithCredential: vi.fn(async () => {}),
    reauthenticateWithPopup: vi.fn(async () => {}),
    EmailAuthProvider: { credential: () => ({}) },
    deleteUser: vi.fn(async () => {}),
    updatePassword: vi.fn(),
    GoogleAuthProvider: class {},
    signInWithPopup: vi.fn(),
    getAdditionalUserInfo: vi.fn(),
    ...authMock,
  }));
  vi.doMock('./accountDeletion', () => ({ deleteAccountData: async () => {}, clearLocalAccountStorage: () => {} }));
  vi.doMock('./referrals', () => ({ recordReferralIfPending: calls.recordReferralIfPending }));
  vi.doMock('./friends', () => ({ touchLastActive: async () => {} }));
  vi.doMock('./openDays', () => ({ recordOpenDay: async () => {} }));
  vi.doMock('./onboardingSave', () => ({ markNewSignup: async () => {} }));
  vi.doMock('./pushSignOut', () => ({ cleanUpPushOnSignOut: async () => {} }));
  Object.entries(extra).forEach(([k, v]) => vi.doMock(k, () => v));
  const { AuthProvider, useAuth } = await import('./AuthContext.jsx');
  const probe = {};
  function Probe() {
    probe.ctx = useAuth();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () =>
    root.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    )
  );
  const signIn = (u) => {
    fb.auth.currentUser = u;
    return act(async () => authCb(u));
  };
  return { fb, probe, signIn, calls };
}

describe('refreshUser', () => {
  it('re-renders with emailVerified=true when reload() flips it on the same object', async () => {
    const cur = { uid: 'A', emailVerified: false };
    const { probe, signIn } = await setup({
      reload: async (u) => {
        u.emailVerified = true; // Firebase mutates currentUser in place
      },
    });
    await signIn(cur);
    expect(probe.ctx.user.emailVerified).toBe(false);
    await act(async () => probe.ctx.refreshUser());
    // A new object, or consumers keyed on `user` never re-render (the
    // banner read the same mutated object and stayed up).
    expect(probe.ctx.user).not.toBe(cur);
    expect(probe.ctx.user.emailVerified).toBe(true);
    expect(probe.ctx.user.uid).toBe('A');
  });

  it('keeps the same user reference when nothing changed', async () => {
    const cur = { uid: 'A', emailVerified: false };
    const { probe, signIn } = await setup();
    await signIn(cur);
    const before = probe.ctx.user;
    await act(async () => probe.ctx.refreshUser());
    expect(probe.ctx.user).toBe(before);
  });
});

describe('signUpEmail', () => {
  it('still sends verification and records the referral when updateProfile fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fb, probe, calls } = await setup({
      updateProfile: async () => {
        throw new Error('network');
      },
    });
    fb.auth.currentUser = { uid: 'N', emailVerified: false };
    let result;
    await act(async () => {
      result = await probe.ctx.signUpEmail('a@b.co', 'pw123456', 'Ann');
    });
    expect(result.uid).toBe('N');
    expect(calls.sendEmailVerification).toHaveBeenCalled();
    expect(calls.recordReferralIfPending).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('signUpEmail display name', () => {
  it('trims and caps the name at 200 chars (the firestore.rules userName limit)', async () => {
    const updateProfile = vi.fn(async () => {});
    const { fb, probe } = await setup({ updateProfile });
    fb.auth.currentUser = { uid: 'N', emailVerified: false };
    await act(async () => {
      await probe.ctx.signUpEmail('a@b.co', 'pw123456', `  ${'x'.repeat(300)}  `);
    });
    expect(updateProfile.mock.calls[0][1].displayName).toBe('x'.repeat(200));
  });
});
