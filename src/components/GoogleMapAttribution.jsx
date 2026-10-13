import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { googleViewportCopyright } from '../lib/googleTiles';

// Google's required attribution for Map Tiles: the Google logo at the bottom
// left, and the copyright line for what's on screen (from the viewport
// endpoint), refreshed as the map moves. Lives inside the MapContainer.
const LOGO = 'https://maps.gstatic.com/mapfiles/api-3/images/google_white5_hdpi.png';

export default function GoogleMapAttribution({ session }) {
  const map = useMap();
  const last = useRef('');

  useEffect(() => {
    const Logo = L.Control.extend({
      onAdd() {
        const img = L.DomUtil.create('img', 'google-map-logo');
        img.src = LOGO;
        img.alt = 'Google';
        img.setAttribute('aria-label', 'Google Maps');
        return img;
      },
    });
    const logo = new Logo({ position: 'bottomleft' });
    logo.addTo(map);
    return () => logo.remove();
  }, [map]);

  useEffect(() => {
    let timer = null;
    let alive = true;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const b = map.getBounds();
        const text = await googleViewportCopyright(session, { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() }, map.getZoom());
        if (!alive || !text || text === last.current) return;
        if (last.current) map.attributionControl?.removeAttribution(last.current);
        last.current = text;
        map.attributionControl?.addAttribution(text);
      }, 400);
    };
    refresh();
    map.on('moveend', refresh);
    return () => {
      alive = false;
      clearTimeout(timer);
      map.off('moveend', refresh);
      if (last.current) map.attributionControl?.removeAttribution(last.current);
      last.current = '';
    };
  }, [map, session]);

  return null;
}
