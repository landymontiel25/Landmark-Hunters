// Cache a region's map tiles (item i4) so the explore/itinerary map still
// renders while offline -- registers the service worker in public/sw.js
// (which serves cached tiles when the network is down) and pre-fetches the
// tiles a "Download for Offline" tap asks for.

const TILE_CACHE = 'map-tiles-v1';
const SUBDOMAINS = ['a', 'b', 'c']; // Leaflet's default {s} rotation for this basemap
const DOWNLOADED_KEY = 'landmarkhunters.offlineRegions';

export function registerOfflineServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* offline support just won't be available -- not fatal */
  });
}

function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

/** Every {z,x,y} tile covering a viewbox across a zoom range. */
export function tilesForViewbox(viewbox, minZoom, maxZoom) {
  const tiles = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const xMin = lonToTileX(viewbox.minLng, z);
    const xMax = lonToTileX(viewbox.maxLng, z);
    const yMin = latToTileY(viewbox.maxLat, z); // higher lat -> smaller y
    const yMax = latToTileY(viewbox.minLat, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

/**
 * Downloads and caches every tile covering a region's viewbox at
 * minZoom..maxZoom, under each of the basemap's rotating subdomains (so a
 * cache hit doesn't depend on which subdomain the live map happens to
 * request from). Reports 0-1 progress via onProgress. Capped at 1500 tiles
 * (roughly a city at zoom 12-15) so this can't accidentally trigger an
 * enormous download.
 */
export async function downloadRegionTiles(region, { minZoom = 12, maxZoom = 15, onProgress } = {}) {
  const tiles = tilesForViewbox(region.viewbox, minZoom, maxZoom).slice(0, 1500);
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  let saved = 0;
  for (const { z, x, y } of tiles) {
    await Promise.all(
      SUBDOMAINS.map(async (s) => {
        const url = `https://${s}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
        try {
          const existing = await cache.match(url);
          if (existing) {
            saved += 1;
          } else {
            const res = await fetch(url);
            if (res.ok) {
              await cache.put(url, res);
              saved += 1;
            }
          }
        } catch {
          /* one failed tile shouldn't abort the whole download */
        }
      })
    );
    done += 1;
    onProgress?.(done / tiles.length);
  }
  // Every tile failing (no signal) must not be reported as "Downloaded".
  if (tiles.length && saved === 0) throw new Error('No map tiles could be downloaded');
  markRegionDownloaded(region.id);
}

function readDownloaded() {
  try {
    const v = JSON.parse(localStorage.getItem(DOWNLOADED_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function markRegionDownloaded(regionId) {
  try {
    const map = readDownloaded();
    map[regionId] = Date.now();
    localStorage.setItem(DOWNLOADED_KEY, JSON.stringify(map));
  } catch {
    /* no-op */
  }
}

export function isRegionDownloaded(regionId) {
  return Boolean(readDownloaded()[regionId]);
}
