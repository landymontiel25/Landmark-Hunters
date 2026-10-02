import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { registerPlaces } from '../../src/data/regions.js';
import { PLACE_PACKS } from '../../src/data/placePacks.manifest.js';

// Server side of src/lib/placePacks.js: the same public/places chunks, read
// from disk (vercel.json includeFiles ships them with the functions that need
// them). Loaded once per function instance.
let loading = null;

export function ensureServerPlacePacks(packs = PLACE_PACKS) {
  if (!packs.length) return Promise.resolve();
  if (!loading) {
    loading = Promise.allSettled(
      packs.map(async (p) => registerPlaces(JSON.parse(await readFile(path.join(process.cwd(), 'public', p.file), 'utf8'))))
    ).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) {
        console.warn(`place packs: ${failed.length} chunk(s) failed to load: ${failed[0].reason?.message || failed[0].reason}`);
        loading = null;
      }
    });
  }
  return loading;
}
