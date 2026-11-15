import { describe, it, expect, vi, afterEach } from 'vitest';

const requestReview = vi.fn(async () => {});
vi.mock('@capacitor-community/in-app-review', () => ({ InAppReview: { requestReview: () => requestReview() } }));
let native = false;
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native } }));

afterEach(() => {
  requestReview.mockClear();
  native = false;
});

describe("requestAppReview (Apple's own review prompt)", () => {
  it("asks Apple's system prompt inside the iOS app", async () => {
    native = true;
    const { requestAppReview } = await import('./appReview');
    expect(await requestAppReview()).toEqual({ shown: true });
    expect(requestReview).toHaveBeenCalledOnce();
  });

  it('does nothing on the web, where there is no system prompt', async () => {
    const { requestAppReview } = await import('./appReview');
    expect(await requestAppReview()).toEqual({ shown: false, reason: 'web' });
    expect(requestReview).not.toHaveBeenCalled();
  });

  it("never throws if the plugin fails", async () => {
    native = true;
    requestReview.mockRejectedValueOnce(new Error('no scene'));
    const { requestAppReview } = await import('./appReview');
    expect(await requestAppReview()).toEqual({ shown: false, reason: 'error' });
  });
});
