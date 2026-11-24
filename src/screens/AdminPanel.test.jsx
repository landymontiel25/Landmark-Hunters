// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let auth = { user: { uid: 'me', email: 'landymontiel25@gmail.com' }, loading: false };
let admin = { canUseAdminMode: true, adminMode: true, setAdminMode: vi.fn(), checkinAnywhere: true, setCheckinAnywhere: vi.fn(async () => {}) };
vi.mock('../lib/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../lib/AdminModeContext', () => ({ useAdminMode: () => admin }));
vi.mock('../lib/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('../lib/announcement', () => ({ subscribeAnnouncement: (cb) => (cb('Live message'), () => {}), setAnnouncement: vi.fn(), clearAnnouncement: vi.fn(), ANNOUNCEMENT_MAX: 280 }));
vi.mock('../lib/onboardingSave', () => ({ restartOnboardingAsNew: vi.fn() }));
const { default: AdminPanel } = await import('./AdminPanel.jsx');

async function render() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () =>
    createRoot(el).render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    )
  );
  return el;
}
afterEach(() => (document.body.innerHTML = ''));

describe('admin panel (owner, 2026-11-23)', () => {
  it('the admin sees all four controls, full screen', async () => {
    const el = await render();
    const text = el.textContent;
    for (const s of ['Check-in radius off', 'Send test notification', 'Preview as a new user', 'Announcement banner', 'Show banner', 'Clear banner']) expect(text).toContain(s);
    expect(el.querySelector('textarea').value).toBe('Live message');
    expect(document.body.classList.contains('admin-panel-open')).toBe(true);
  });
  it('the master Admin Mode switch is first; with it off every other control is disabled', async () => {
    admin = { ...admin, adminMode: false, setAdminMode: vi.fn(async () => {}) };
    const el = await render();
    const switches = [...el.querySelectorAll('input[role="switch"]')];
    expect(el.querySelector('.admin-row-title').textContent).toBe('Admin Mode');
    expect(switches[0].disabled).toBe(false);
    const fs = el.querySelector('fieldset.admin-controls');
    expect(fs.disabled).toBe(true);
    expect(el.textContent).not.toContain('Edit tools');
    await act(async () => switches[0].click());
    expect(admin.setAdminMode).toHaveBeenCalledWith(true);
    admin = { ...admin, adminMode: true };
  });
  it('the radius switch only changes the admin setting', async () => {
    const el = await render();
    const sw = [...el.querySelectorAll('input[role="switch"]')][1];
    await act(async () => sw.click());
    expect(admin.setCheckinAnywhere).toHaveBeenCalledWith(false);
  });
  it('anyone else is sent home', async () => {
    auth = { user: { uid: 'x', email: 'someone@example.com' }, loading: false };
    admin = { ...admin, canUseAdminMode: false };
    const el = await render();
    expect(el.textContent).toBe('home');
  });
});
