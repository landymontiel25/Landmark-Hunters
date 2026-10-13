# Google's map on the Map tab

Online, the Map tab draws Google's satellite imagery with Google's labels
(Map Tiles API, 2D tiles) in the existing Leaflet map. Offline, or with no
key, it keeps the Esri imagery and labels, and the offline download (Carto
tiles cached by `public/sw.js`) keeps working. Only the Map tab changes; the
Itinerary, Add Landmark and Test maps stay Esri.

Why: Google's Service Specific Terms forbid Places content (ratings) "in
conjunction with a non-Google map". With Google's map showing, each landmark
pin popup shows its Google rating (`components/ratings/MapPopupRating.jsx`).
On the Esri fallback the rating is not mounted.

| Piece | File |
| --- | --- |
| Session, tile URL, copyright, online/offline switch | `src/lib/googleTiles.js` |
| Google logo + copyright line on the map | `src/components/GoogleMapAttribution.jsx` |
| Layers and fallback | `src/screens/MapExplore.jsx` (`googleMap`, `googleTileGuard`) |

- Key: `VITE_GOOGLE_MAP_TILES_KEY`, a browser key (tile URLs carry it).
  Restrict it to the Map Tiles API and the site's referrers, and set a daily
  quota on Map Tiles in Google Cloud.
- One session per page load (`createSession`, satellite + `layerRoadmap`).
- If six tiles fail before any loads (bad key, quota), the map switches to
  Esri for that page load so it never goes blank.
- Tiles are never stored: the service worker caches only Carto's host.
- Cost (list price, check Google's pricing page): 2D Map Tiles are free for
  the first 100,000 tiles a month, then about $0.60 per 1,000. A map visit
  loads roughly 30 to 60 tiles.
