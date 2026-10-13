import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useGeo } from '../lib/GeoContext';
import { useToast } from '../lib/ToastContext';
import {
  LIVE_SHARE_OPTIONS,
  VIEWING_HEARTBEAT_MS,
  pushLiveLocation,
  readShares,
  shareUntil,
  shouldPush,
  stopLiveLocation,
  subscribeLiveLocations,
  visibleSharers,
  writeShares,
} from '../lib/liveLocation';

const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const agoOf = (ms, now) => {
  const m = Math.max(0, Math.round((now - ms) / 60000));
  return m < 1 ? 'just now' : m === 1 ? '1 min ago' : `${m} min ago`;
};
const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
const pinFor = (name, mine) =>
  L.divIcon({ className: '', html: `<div class="live-pin${mine ? ' mine' : ''}">${initials(name)}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });

function FitAll({ points }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 15);
    else if (points.length > 1) map.fitBounds(points, { padding: [30, 30], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

// "Live location" on a group trip (WhatsApp-style): everyone on the trip sees
// who is sharing, on a small map, with when they last updated and when the
// share ends. You pick how long to share, and can stop any time.
export default function LiveLocationCard({ tripId, uid, myName }) {
  const { coords, error: geoError } = useGeo();
  const toast = useToast();
  const [docs, setDocs] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [picking, setPicking] = useState(false);
  // A page-only share belongs to one visit: one left from an earlier visit
  // (the app was closed mid-share) is dropped, never resumed.
  const [share, setShare] = useState(() => {
    const all = readShares();
    if (all[tripId]?.mode === 'viewing') {
      delete all[tripId];
      writeShares(all);
      return null;
    }
    return all[tripId] || null;
  });
  const last = useRef(null);

  useEffect(() => subscribeLiveLocations(tripId, setDocs, () => setDocs([])), [tripId]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const reload = () => setShare(readShares()[tripId] || null);
    window.addEventListener('lh-live-shares', reload);
    return () => window.removeEventListener('lh-live-shares', reload);
  }, [tripId]);

  // "While on this page": write while this card is on screen, each write
  // renewing a 2-minute expiry; leaving the page ends it.
  const viewing = share?.mode === 'viewing';
  useEffect(() => {
    if (!viewing || !shouldPush(last.current, coords)) return;
    last.current = { lat: coords.lat, lng: coords.lng, at: Date.now() };
    pushLiveLocation({ tripId, uid, name: myName, coords, mode: 'viewing', expiresAt: Date.now() + VIEWING_HEARTBEAT_MS }).catch(() => {
      last.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing, coords?.lat, coords?.lng, now, tripId, uid, myName]);
  useEffect(
    () => () => {
      const all = readShares();
      if (all[tripId]?.mode === 'viewing') {
        delete all[tripId];
        writeShares(all);
        stopLiveLocation(tripId, uid).catch(() => {});
      }
    },
    [tripId, uid]
  );

  const start = (optionId) => {
    setPicking(false);
    const all = readShares();
    all[tripId] = { mode: optionId === 'viewing' ? 'viewing' : 'timed', until: optionId === 'viewing' ? null : shareUntil(optionId), name: myName };
    last.current = null;
    writeShares(all);
    if (coords && optionId !== 'viewing') {
      pushLiveLocation({ tripId, uid, name: myName, coords, mode: 'timed', expiresAt: all[tripId].until }).catch(() =>
        toast?.show("Couldn't share your location. Try again.")
      );
    }
  };
  const stop = () => {
    const all = readShares();
    delete all[tripId];
    writeShares(all);
    last.current = null;
    stopLiveLocation(tripId, uid)
      .then(() => toast?.show('You stopped sharing your location.', { tone: 'info' }))
      .catch(() => toast?.show("Couldn't stop sharing. Try again."));
  };

  const sharers = useMemo(() => visibleSharers(docs, now), [docs, now]);
  const points = sharers.map((s) => [s.lat, s.lng]);
  const sharing = !!share && (share.mode === 'viewing' || share.until > now);

  return (
    <div className="card section live-card">
      <h3 style={{ marginTop: 0 }}>{'\u{1F4CD}'} Live location</h3>
      {sharing ? (
        <div className="live-mine">
          <span className="live-dot" aria-hidden="true" />
          <span>
            You're sharing your live location{' '}
            {share.mode === 'viewing' ? "while you're on this page" : `until ${timeOf(share.until)}`}.
          </span>
          <button type="button" className="btn btn-danger btn-sm" onClick={stop}>
            Stop sharing
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary btn-block" onClick={() => setPicking(true)} disabled={!coords}>
          {coords ? 'Share live location' : geoError ? 'Turn on location to share it' : 'Finding your location…'}
        </button>
      )}

      {points.length > 0 ? (
        <>
          <div className="live-map">
            <MapContainer center={points[0]} zoom={14} style={{ height: '100%', width: '100%' }} attributionControl={false}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
              <FitAll points={points} />
              {sharers.map((s) => (
                <Marker key={s.uid} position={[s.lat, s.lng]} icon={pinFor(s.name, s.uid === uid)}>
                  <Tooltip direction="top" offset={[0, -16]}>
                    {s.uid === uid ? 'You' : s.name}
                  </Tooltip>
                </Marker>
              ))}
            </MapContainer>
          </div>
          <ul className="live-list">
            {sharers.map((s) => (
              <li key={s.uid}>
                <strong>{s.uid === uid ? 'You' : s.name}</strong>
                <span>
                  updated {agoOf(s.updatedAtMs, now)}
                  {s.mode === 'viewing' ? ' · while on the trip page' : ` · until ${timeOf(s.expiresAt)}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="screen-subtitle" style={{ margin: '10px 0 0' }}>
          No one on this trip is sharing their location right now.
        </p>
      )}

      {picking &&
        createPortal(
          <div className="modal-backdrop" onClick={() => setPicking(false)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0 }}>Share live location</h3>
              <p className="screen-subtitle" style={{ marginTop: 0 }}>
                Everyone on this trip sees where you are on this page. It updates while the app is open, and you can stop any time.
              </p>
              {LIVE_SHARE_OPTIONS.map((o) => (
                <button key={o.id} type="button" className="save-sheet-row" onClick={() => start(o.id)}>
                  <span>{o.label}</span>
                </button>
              ))}
              <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setPicking(false)}>
                Cancel
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
