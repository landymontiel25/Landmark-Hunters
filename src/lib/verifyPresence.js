import { Geolocation } from '@capacitor/geolocation';
import { API_BASE } from './apiBase';
import { authHeaders } from './apiAuth';

// Asks the server to verify a check-in that was just saved
// (api/verify-checkin.js, docs/discovery-network-plan.md Phase 0). Takes a
// fresh GPS fix first: the shared watch in GeoContext keeps an old fix while
// you stand still, and the server only accepts a fix under 2 minutes old.
// Never throws and never blocks the check-in: on any failure it resolves to
// null and the check-in stays unverified.
export const VERIFY_TIMEOUT_MS = 15000;

async function freshFix(getPosition) {
  const pos = await getPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  const c = pos?.coords;
  if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return null;
  return {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: Number.isFinite(c.accuracy) ? c.accuracy : 9999,
    timestamp: Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now(),
  };
}

export async function verifyCheckinPresence(
  checkinId,
  { fetchImpl = fetch, getPosition = (o) => Geolocation.getCurrentPosition(o), timeoutMs = VERIFY_TIMEOUT_MS } = {}
) {
  if (!checkinId) return null;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const fix = await freshFix(getPosition);
    if (!fix) return null;
    const r = await fetchImpl(`${API_BASE}/api/verify-checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ checkinId, fix }),
      signal: controller?.signal,
    });
    if (!r.ok) return null;
    const body = await r.json().catch(() => null);
    return body && typeof body.verified === 'boolean' ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
