import { describe, it, expect, vi } from 'vitest';
import { sharedRead, invalidating } from './sharedRead';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('sharedRead', () => {
  it('runs one load for reads that overlap, and hands each caller its own array', async () => {
    let release;
    const load = vi.fn(() => new Promise((r) => (release = () => r([3, 1, 2]))));
    const a = sharedRead('k', load);
    const b = sharedRead('k', load);
    const c = sharedRead('k', load);
    await tick();
    release();
    const [ra, rb] = await Promise.all([a, b, c]);
    expect(load).toHaveBeenCalledTimes(1);
    ra.sort();
    expect(rb).toEqual([3, 1, 2]);
  });

  it('does not cache once a read has settled, so later reads are fresh', async () => {
    const load = vi.fn().mockResolvedValueOnce(['old']).mockResolvedValueOnce(['new']);
    expect(await sharedRead('k2', load)).toEqual(['old']);
    expect(await sharedRead('k2', load)).toEqual(['new']);
  });

  it('a finished write drops the in-flight read so the next read refetches', async () => {
    let release;
    const load = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (release = () => r(['stale']))))
      .mockResolvedValue(['fresh']);
    const first = sharedRead('k3', load);
    await tick();
    await invalidating(async () => {})();
    expect(await sharedRead('k3', load)).toEqual(['fresh']);
    release();
    expect(await first).toEqual(['stale']);
  });

  it('a failed read is not shared with the next caller', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(['ok']);
    await expect(sharedRead('k4', load)).rejects.toThrow('offline');
    expect(await sharedRead('k4', load)).toEqual(['ok']);
  });
});
