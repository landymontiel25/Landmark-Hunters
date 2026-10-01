import { describe, it, expect, vi } from 'vitest';
import { tilesForViewbox } from './offlineMap';

describe('tilesForViewbox', () => {
  it('returns at least one tile per zoom level for a real viewbox', () => {
    const viewbox = { minLat: 25.3, minLng: -80.6, maxLat: 25.95, maxLng: -80.05 };
    const tiles = tilesForViewbox(viewbox, 10, 12);
    const zooms = new Set(tiles.map((t) => t.z));
    expect(zooms).toEqual(new Set([10, 11, 12]));
    for (const z of [10, 11, 12]) {
      expect(tiles.filter((t) => t.z === z).length).toBeGreaterThan(0);
    }
  });

  it('covers more tiles at a higher zoom for the same area', () => {
    const viewbox = { minLat: 25.3, minLng: -80.6, maxLat: 25.95, maxLng: -80.05 };
    const low = tilesForViewbox(viewbox, 10, 10).length;
    const high = tilesForViewbox(viewbox, 14, 14).length;
    expect(high).toBeGreaterThan(low);
  });

  it('produces no duplicate {z,x,y} tiles', () => {
    const viewbox = { minLat: 25.3, minLng: -80.6, maxLat: 25.95, maxLng: -80.05 };
    const tiles = tilesForViewbox(viewbox, 11, 13);
    const keys = tiles.map((t) => `${t.z}/${t.x}/${t.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('downloadRegionTiles', () => {
  it('fails (and does not mark the region downloaded) when no tile could be fetched', async () => {
    const { downloadRegionTiles, isRegionDownloaded } = await import('./offlineMap');
    vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined, put: async () => {} }) });
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    const region = { id: 'x-test', viewbox: { minLat: 25.3, minLng: -80.6, maxLat: 25.31, maxLng: -80.59 } };
    await expect(downloadRegionTiles(region, { minZoom: 12, maxZoom: 12 })).rejects.toThrow();
    expect(isRegionDownloaded('x-test')).toBe(false);
    vi.unstubAllGlobals();
  });
});
