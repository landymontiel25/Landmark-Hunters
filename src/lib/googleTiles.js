import { useEffect, useMemo, useState } from 'react';

// Google's map (Map Tiles API, 2D tiles) for the Map tab while online
// (docs/google-map.md). Offline, or with no key set, the map keeps its
// Esri/Carto layers and the offline download, untouched.
//
// The key is a browser key (VITE_GOOGLE_MAP_TILES_KEY): tile URLs carry it, so
// it must be restricted to the Map Tiles API (and the site's referrers) in
// Google Cloud. Tiles are never stored (Google's terms): the service worker
// caches only the offline basemap's host, and nothing here writes to storage
// except the session token, which is not map content.

export const GOOGLE_TILES_KEY = import.meta.env?.VITE_GOOGLE_MAP_TILES_KEY || '';
const API = 'https://tile.googleapis.com';
// Satellite imagery with Google's road and place labels on top (like the old
// Esri imagery + labels pair).
const SESSION_BODY = { mapType: 'satellite', language: 'en-US', region: 'US', layerTypes: ['layerRoadmap'] };

let sessionPromise = null;
// One session per page load (a session lasts about two weeks; Google
// recommends reusing it rather than making one per map).
export function getGoogleTilesSession({ key = GOOGLE_TILES_KEY, fetchImpl = fetch } = {}) {
  if (!key) return Promise.resolve(null);
  if (!sessionPromise) {
    sessionPromise = fetchImpl(`${API}/v1/createSession?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SESSION_BODY),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.session ? { session: d.session, expiry: Number(d.expiry) || 0 } : null))
      .catch(() => null)
      .then((s) => {
        if (!s) sessionPromise = null; // try again next time
        return s;
      });
  }
  return sessionPromise;
}

export function googleTileUrl(session, key = GOOGLE_TILES_KEY) {
  return `${API}/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`;
}

// The copyright line Google requires for what is on screen right now.
export async function googleViewportCopyright(session, bounds, zoom, { key = GOOGLE_TILES_KEY, fetchImpl = fetch } = {}) {
  const qs = new URLSearchParams({
    session,
    key,
    zoom: String(Math.round(zoom)),
    north: String(bounds.north),
    south: String(bounds.south),
    east: String(bounds.east),
    west: String(bounds.west),
  });
  try {
    const r = await fetchImpl(`${API}/tile/v1/viewport?${qs}`);
    if (!r.ok) return '';
    const d = await r.json();
    return typeof d?.copyright === 'string' ? d.copyright : '';
  } catch {
    return '';
  }
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/**
 * { session, onTilesFailed } while Google's map should show (online, key
 * set, session made, tiles loading), or null for the Esri/Carto fallback.
 * Flips to the fallback the moment the phone goes offline, and back to Google
 * when it comes back.
 */
export function useGoogleTiles({ key = GOOGLE_TILES_KEY } = {}) {
  const [online, setOnline] = useState(isOnline);
  const [session, setSession] = useState(null);
  // Tiles that fail before any loads (bad key, daily cap reached): give up on
  // Google for this page load so the map never goes blank.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  useEffect(() => {
    if (!online || !key || session) return undefined;
    let alive = true;
    getGoogleTilesSession({ key }).then((s) => alive && s && setSession(s.session));
    return () => {
      alive = false;
    };
  }, [online, key, session]);

  // Stable identity: the Map tab memoizes its markers on this value.
  const active = online && !!key && !!session && !failed;
  return useMemo(() => (active ? { session, onTilesFailed: () => setFailed(true) } : null), [active, session]);
}

// Tests only.
export function _resetGoogleTiles() {
  sessionPromise = null;
}
