import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function load(over = {}) {
  const removePushToken = vi.fn(async () => {});
  const push = {
    hasPushPermission: async () => true,
    getPushToken: async () => 'tok1',
    deletePushToken: vi.fn(async () => {}),
    removePushListeners: vi.fn(async () => {}),
    ...over,
  };
  vi.doMock('./friends', () => ({ removePushToken }));
  vi.doMock('./pushNotifications', () => push);
  const { cleanUpPushOnSignOut } = await import('./pushSignOut.js');
  return { cleanUpPushOnSignOut, removePushToken, push };
}

describe('cleanUpPushOnSignOut', () => {
  it("removes this device's token from the signed-out account", async () => {
    const { cleanUpPushOnSignOut, removePushToken, push } = await load();
    await cleanUpPushOnSignOut('u1');
    expect(removePushToken).toHaveBeenCalledWith('u1', 'tok1');
    expect(push.deletePushToken).toHaveBeenCalled();
  });
  it('never throws when the native plugin fails', async () => {
    const { cleanUpPushOnSignOut } = await load({
      hasPushPermission: async () => {
        throw new Error('no plugin');
      },
      deletePushToken: async () => {
        throw new Error('no plugin');
      },
    });
    await expect(cleanUpPushOnSignOut('u1')).resolves.toBeUndefined();
  });
  it('skips the token lookup without permission', async () => {
    const { cleanUpPushOnSignOut, removePushToken } = await load({ hasPushPermission: async () => false });
    await cleanUpPushOnSignOut('u1');
    expect(removePushToken).not.toHaveBeenCalled();
  });
});
