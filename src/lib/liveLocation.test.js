import { describe, it, expect, vi } from 'vitest';

vi.mock('./firebase', () => ({ db: null }));
import { LIVE_SHARE_OPTIONS, REFRESH_MS, VIEWING_HEARTBEAT_MS, shareUntil, shouldPush, visibleSharers } from './liveLocation';

describe('live location', () => {
  it('offers WhatsApp-style lengths plus only-while-viewing', () => {
    expect(LIVE_SHARE_OPTIONS.map((o) => o.id)).toEqual(['viewing', '15m', '1h', '8h']);
    expect(shareUntil('1h', 1000)).toBe(1000 + 60 * 60 * 1000);
    expect(shareUntil('viewing', 1000)).toBe(1000 + VIEWING_HEARTBEAT_MS);
    expect(shareUntil('forever', 1000)).toBeNull();
  });

  it('writes on the first fix, after moving, or after a while', () => {
    const at = 1_000_000;
    const here = { lat: 25.77, lng: -80.19 };
    expect(shouldPush(null, here, at)).toBe(true);
    expect(shouldPush({ ...here, at }, here, at + 5000)).toBe(false);
    expect(shouldPush({ ...here, at }, { lat: 25.7705, lng: -80.19 }, at + 5000)).toBe(true); // ~55 m
    expect(shouldPush({ ...here, at }, here, at + REFRESH_MS)).toBe(true);
    expect(shouldPush(null, null, at)).toBe(false);
  });

  it('hides shares that have ended', () => {
    const now = 5000;
    const docs = [
      { uid: 'a', lat: 1, lng: 1, expiresAt: 9000, updatedAtMs: 1 },
      { uid: 'b', lat: 1, lng: 1, expiresAt: 4000, updatedAtMs: 2 },
      { uid: 'c', lat: 1, lng: 1, expiresAt: 9000, updatedAtMs: 3 },
    ];
    expect(visibleSharers(docs, now).map((d) => d.uid)).toEqual(['c', 'a']);
  });
});
