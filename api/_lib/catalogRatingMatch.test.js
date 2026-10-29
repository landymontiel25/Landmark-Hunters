import { describe, it, expect, vi } from 'vitest';
import { catalogGooglePlaceId } from './catalogRatingMatch.js';

const art = { region: 'miami', id: 'art-deco', name: 'Art Deco Historic District and Ocean Drive', lat: 25.7825, lng: -80.1301, categories: ['history-culture'] };
const cand = (over) => ({ id: 'ChIJart', name: 'Art Deco Historic District', lat: 25.7825, lng: -80.1301, ...over });
const deps = (over = {}) => ({ read: vi.fn(async () => null), write: vi.fn(async () => {}), search: vi.fn(async () => [cand()]), ...over });

describe('catalogGooglePlaceId', () => {
  it('uses the stored place ID without searching', async () => {
    const d = deps({ read: vi.fn(async () => ({ status: 'ok', placeId: 'ChIJstored' })) });
    expect(await catalogGooglePlaceId(art, d)).toBe('ChIJstored');
    expect(d.search).not.toHaveBeenCalled();
  });

  it('matches a sure candidate once and saves only the ID', async () => {
    const d = deps();
    expect(await catalogGooglePlaceId(art, d)).toBe('ChIJart');
    expect(d.write).toHaveBeenCalledWith('miami__art-deco', { status: 'ok', placeId: 'ChIJart', matchedName: 'Art Deco Historic District', lat: art.lat, lng: art.lng });
  });

  it('a district whose Google pin sits farther off than the sure radius is still matched', async () => {
    const d = deps({ search: vi.fn(async () => [cand({ lat: 25.7825 + 0.0055 })]) }); // ~610 m north
    expect(await catalogGooglePlaceId(art, d)).toBe('ChIJart');
  });

  it('a district whose pin sits over a kilometer from Google\'s still gets its rating', async () => {
    const pinned = { ...art, lat: 25.794, lng: -80.13 }; // our pin ~1.3 km north of Google's
    const d = deps();
    expect(await catalogGooglePlaceId(pinned, d)).toBe('ChIJart');
  });

  it('a single building with the right name but far off is not guessed', async () => {
    const shop = { region: 'miami', id: 'cafe', name: 'Cafe Roma', lat: 25.78, lng: -80.13, categories: ['food'] };
    const d = deps({ search: vi.fn(async () => [{ id: 'ChIJother', name: 'Cafe Roma', lat: 25.78 + 0.0055, lng: -80.13 }]) });
    expect(await catalogGooglePlaceId(shop, d)).toBeNull();
    expect(d.write).toHaveBeenCalledWith('miami__cafe', expect.objectContaining({ status: 'no-match', placeId: null }));
  });

  it('remembers a no-match for 30 days, then tries again', async () => {
    const fresh = deps({ read: vi.fn(async () => ({ status: 'no-match', verifiedAt: Date.now() - 1000 })) });
    expect(await catalogGooglePlaceId(art, fresh)).toBeNull();
    expect(fresh.search).not.toHaveBeenCalled();
    const old = deps({ read: vi.fn(async () => ({ status: 'no-match', verifiedAt: Date.now() - 40 * 24 * 60 * 60 * 1000 })) });
    expect(await catalogGooglePlaceId(art, old)).toBe('ChIJart');
  });

  it('needs a name and a spot, and lets a failed search throw', async () => {
    expect(await catalogGooglePlaceId({ ...art, name: '' }, deps())).toBeNull();
    expect(await catalogGooglePlaceId({ ...art, lat: NaN }, deps())).toBeNull();
    await expect(catalogGooglePlaceId(art, deps({ search: vi.fn(async () => { throw new Error('google search 503'); }) }))).rejects.toThrow('503');
  });
});
