import { useEffect, useState } from 'react';
import { streetAddress, cachedStreetAddress } from './geocode';

// Street address for each stop ({ id, lat, lng, address? }), for the caption
// under it on an itinerary or group trip. Stops that already carry an
// address (Mapr-found places) keep theirs. Cached per device; new lookups go
// one per second, Nominatim's limit (streetAddress spaces them). Returns { [id]: address }.
export function useStopAddresses(stops) {
  const [addresses, setAddresses] = useState({});
  const key = stops.map((s) => `${s.id}@${s.lat},${s.lng}`).join('|');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const s of stops) {
        if (cancelled) return;
        if (s.address || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
        const cached = cachedStreetAddress(s.lat, s.lng);
        const a = cached || (await streetAddress(s.lat, s.lng));
        if (cancelled) return;
        if (a) setAddresses((cur) => (cur[s.id] === a ? cur : { ...cur, [s.id]: a }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `key` captures the stops that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return addresses;
}
