// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

let resolvePermission;
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../lib/friends', () => ({ setBackgroundLocationEnabled: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/backgroundLocation', () => ({
  requestAlwaysPermission: () => new Promise((r) => (resolvePermission = r)),
}));

describe('LocationAlwaysStep', () => {
  it('moves on once when "Not now" is tapped while the permission dialog is up', async () => {
    const { default: LocationAlwaysStep } = await import('./LocationAlwaysStep.jsx');
    const onDone = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => createRoot(el).render(<LocationAlwaysStep onDone={onDone} />));
    const [enable, later] = el.querySelectorAll('button');
    await act(async () => enable.click());
    await act(async () => later.click());
    await act(async () => resolvePermission(true));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
