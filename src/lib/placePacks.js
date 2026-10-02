import { useSyncExternalStore } from 'react';
import { registerPlaces, getCatalogVersion, subscribeCatalog } from '../data/regions';
import { PLACE_PACKS, PLACE_PACK_ID_PREFIX } from '../data/placePacks.manifest';

// Imported places (OpenStreetMap) ship as static JSON chunks in public/places,
// outside the JS bundle. They load once, after the first screen, and join the
// catalog through registerPlaces.

export const isPlacePackId = (id) => typeof id === 'string' && id.startsWith(PLACE_PACK_ID_PREFIX);

let loading = null;

async function loadChunk(pack) {
  const base = import.meta.env?.BASE_URL || '/';
  const res = await fetch(`${base}${pack.file}`);
  if (!res.ok) throw new Error(`place pack ${pack.file}: HTTP ${res.status}`);
  return registerPlaces(await res.json());
}

// Resolves true once every chunk has loaded, false if any failed (offline).
// A failed load is retried on the next call.
export function ensurePlacePacks(packs = PLACE_PACKS) {
  if (!packs.length) return Promise.resolve(true);
  if (!loading) {
    loading = Promise.allSettled(packs.map(loadChunk)).then((results) => {
      const ok = results.every((r) => r.status === 'fulfilled');
      if (!ok) loading = null;
      return ok;
    });
  }
  return loading;
}

export function usePlacePacksVersion() {
  return useSyncExternalStore(subscribeCatalog, getCatalogVersion, getCatalogVersion);
}

export function resetPlacePacksForTest() {
  loading = null;
}
