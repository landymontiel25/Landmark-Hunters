import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useGeo } from '../lib/GeoContext';
import { REFRESH_MS, pushLiveLocation, readShares, shouldPush, stopLiveLocation, writeShares } from '../lib/liveLocation';

// Keeps this device's timed live-location shares (15 minutes, 1 hour, 8
// hours) updating from anywhere in the app, and ends each one on time. A
// browser can't run in the background, so a share only moves while the app
// is open; the others see "updated N min ago". "While on this trip's page"
// shares are run by the trip page itself (LiveLocationCard). Renders nothing.
export default function LiveLocationSharer() {
  const { user } = useAuth();
  const { coords } = useGeo();
  const [shares, setShares] = useState(readShares);
  const last = useRef({});
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  // A "while on this trip's page" share never outlives the visit: if the app
  // was closed mid-share, drop it at start instead of quietly resuming.
  useEffect(() => {
    const all = readShares();
    const stale = Object.keys(all).filter((id) => all[id]?.mode === 'viewing');
    if (!stale.length) return;
    for (const id of stale) delete all[id];
    writeShares(all);
  }, []);

  useEffect(() => {
    const reload = () => setShares(readShares());
    window.addEventListener('lh-live-shares', reload);
    return () => window.removeEventListener('lh-live-shares', reload);
  }, []);

  useEffect(() => {
    if (!user?.uid) return undefined;
    const tick = () => {
      const now = Date.now();
      const all = readShares();
      let changed = false;
      for (const [tripId, s] of Object.entries(all)) {
        if (s?.mode !== 'timed') continue;
        if (!(s.until > now)) {
          stopLiveLocation(tripId, user.uid).catch(() => {});
          delete all[tripId];
          delete last.current[tripId];
          changed = true;
          continue;
        }
        const c = coordsRef.current;
        if (!shouldPush(last.current[tripId], c, now)) continue;
        last.current[tripId] = { lat: c.lat, lng: c.lng, at: now };
        pushLiveLocation({ tripId, uid: user.uid, name: s.name, coords: c, mode: 'timed', expiresAt: s.until }).catch(() => {
          delete last.current[tripId];
        });
      }
      if (changed) writeShares(all);
    };
    tick();
    const id = setInterval(tick, Math.min(REFRESH_MS, 15000));
    return () => clearInterval(id);
  }, [user?.uid, shares, coords?.lat, coords?.lng]);

  return null;
}
