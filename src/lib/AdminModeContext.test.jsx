// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const auth = { value: { user: null, loading: true } };
vi.mock('./AuthContext', () => ({ useAuth: () => auth.value }));
// The admin's switches live in admin_settings/{uid} (owner, 2026-11-23).
const store = { settings: { adminMode: true, checkinAnywhere: true }, saved: [] };
vi.mock('./adminSettings', () => ({
  DEFAULT_ADMIN_SETTINGS: { adminMode: false, checkinAnywhere: true },
  subscribeAdminSettings: (uid, cb) => (cb(store.settings), () => {}),
  saveAdminSettings: async (uid, s) => store.saved.push({ uid, ...s }),
}));

import { AdminModeProvider, useAdminMode } from './AdminModeContext';
import { checksInAnywhere } from './admins';

let seen;
function Probe() {
  seen = useAdminMode();
  return null;
}
const tree = () => (
  <AdminModeProvider>
    <Probe />
  </AdminModeProvider>
);
const ADMIN = { uid: 'me', email: 'landymontiel25@gmail.com' };

describe('AdminModeProvider: one Admin Mode, saved to the account', () => {
  beforeEach(() => {
    store.saved = [];
  });

  it("follows the account's master switch, and the bypass needs both switches", async () => {
    store.settings = { adminMode: true, checkinAnywhere: true };
    auth.value = { user: ADMIN, loading: false };
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(tree()));
    expect(seen.adminMode).toBe(true);
    expect(checksInAnywhere(ADMIN)).toBe(true);
    // Master off: a normal user, no bypass even with the radius switch on.
    await act(async () => seen.setAdminMode(false));
    expect(seen.adminMode).toBe(false);
    expect(checksInAnywhere(ADMIN)).toBe(false);
    expect(store.saved.at(-1)).toMatchObject({ uid: 'me', adminMode: false, checkinAnywhere: true });
  });

  it('never for a non-admin account, whatever is stored', async () => {
    auth.value = { user: { uid: 'x', email: 'someone@example.com' }, loading: false };
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(tree()));
    expect(seen.adminMode).toBe(false);
    expect(seen.canUseAdminMode).toBe(false);
    expect(checksInAnywhere({ email: 'someone@example.com' })).toBe(false);
  });
});
