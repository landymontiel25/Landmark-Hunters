// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const auth = { value: { user: null, loading: true } };
vi.mock('./AuthContext', () => ({ useAuth: () => auth.value }));

import { AdminModeProvider, useAdminMode } from './AdminModeContext';

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

describe('AdminModeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('landmarkhunters.adminMode', '1');
  });

  it('stays on across a reload: the signed-out moment while auth loads must not switch it off', async () => {
    auth.value = { user: null, loading: true };
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(tree()));
    expect(seen.adminMode).toBe(false); // not known to be an admin yet
    auth.value = { user: { email: 'landymontiel25@gmail.com' }, loading: false };
    await act(async () => root.render(tree()));
    expect(seen.adminMode).toBe(true);
  });

  it('turns off for a non-admin account once auth has loaded', async () => {
    auth.value = { user: { email: 'someone@example.com' }, loading: false };
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(tree()));
    expect(seen.adminMode).toBe(false);
    expect(seen.canUseAdminMode).toBe(false);
  });
});
