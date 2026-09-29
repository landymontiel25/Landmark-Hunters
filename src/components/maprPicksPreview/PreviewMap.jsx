import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { withinDistance } from '../../lib/nearbyPicks';

// The map behind the picks sheet: same dark street tiles as the Map tab,
// and the same pin markup (.map-pin / .map-pin-checked-in in theme.css), so
// pin colors come from the one existing stylesheet and are never restyled
// here -- green is visited, blue is not visited. Look-only: nothing on it
// checks in, edits, or saves anything.

const TILES = {
  url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
};

const PIN = {};
function pinIcon(visited) {
  const key = visited ? 'visited' : 'not-visited';
  PIN[key] ||= L.divIcon({
    className: '',
    html: `<div class="map-pin-wrap"><div class="map-pin ${visited ? 'map-pin-checked-in' : ''}"></div></div>`,
    iconSize: [22, 26],
    iconAnchor: [10, 24],
  });
  return PIN[key];
}

const userIcon = L.divIcon({
  className: '',
  html: '<div class="map-pin-user"><div class="map-pin-user-pulse"></div></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function Recenter({ center, zoom }) {
  const map = useMap();
  const lat = center?.lat;
  const lng = center?.lng;
  useEffect(() => {
    if (lat != null) map.setView([lat, lng], zoom, { animate: false });
  }, [map, lat, lng, zoom]);
  return null;
}

// Most pins drawn at once, closest first, so a 100-mile circle stays light.
const MAX_PINS = 150;

export default function PreviewMap({ center, showUser = true, landmarks = [], visitedIds = [], radiusMiles = 10 }) {
  const visited = useMemo(() => new Set(visitedIds), [visitedIds]);
  const pins = useMemo(
    () => (center ? withinDistance(landmarks, center, Math.max(radiusMiles, 5)).slice(0, MAX_PINS) : []),
    [center, landmarks, radiusMiles]
  );
  const start = center || { lat: 20, lng: 0 };
  return (
    <MapContainer
      center={[start.lat, start.lng]}
      zoom={center ? 14 : 2}
      zoomControl={false}
      attributionControl={false}
      scrollWheelZoom={false}
      className="mpp-map"
      style={{ height: '100%', width: '100%' }}
    >
      <Recenter center={center} zoom={14} />
      <TileLayer url={TILES.url} attribution={TILES.attribution} />
      {pins.map((l) => (
        <Marker key={`${l.regionId}/${l.id}`} position={[l.lat, l.lng]} icon={pinIcon(visited.has(l.id))} interactive={false} />
      ))}
      {center && showUser && <Marker position={[center.lat, center.lng]} icon={userIcon} interactive={false} zIndexOffset={1000} />}
    </MapContainer>
  );
}
