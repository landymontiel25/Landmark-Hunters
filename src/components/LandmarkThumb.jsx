import { useState } from 'react';
import { paletteFor, iconFor } from '../lib/landmarkVisuals';
import { usePlacePhoto } from '../lib/usePlacePhoto';
import PlacePhotoCredit from './PlacePhotoCredit';

// Compact, non-swipeable thumbnail for dense contexts (list rows, itinerary
// stops, map popups) where the decorative postcard frame doesn't fit.
//
// myPhoto: the signed-in viewer's own check-in photo for this landmark, if
// any -- shown instead of the landmark's default photo, just for them.
//
// A photo that fails to load (deleted upload, dead link, offline) falls
// through to the next one, then to the colored category tile -- never the
// browser's broken-image icon. It shimmers softly while loading.
//
// A landmark with no photo at all (and no myPhoto) lazily asks for a Google
// Places photo once the tile scrolls into view (see docs/photos.md), shown
// with its required "Photo: <author> via Google Maps" credit; any failure
// leaves the colored tile.
export default function LandmarkThumb({ landmark, size = 52, width, height, myPhoto }) {
  const [failed, setFailed] = useState(() => new Set());
  const [loaded, setLoaded] = useState(null);
  const image = [myPhoto, ...(landmark.images || [])].find((src) => src && !failed.has(src));
  const wantsFallback = !myPhoto && !landmark.images?.length;
  // Imported places only look up a Google photo when opened (detail page,
  // pick and swipe cards), so scrolling a long list can't spend the day's
  // search quota.
  const place = usePlacePhoto(landmark, { enabled: wantsFallback, lookup: landmark.source !== 'osm' });
  const w = width ?? size;
  const h = height ?? size;
  const style = { width: w, height: h };

  if (image) {
    return (
      <img
        src={image}
        alt={landmark.name}
        className={`landmark-thumb ${loaded === image ? '' : 'img-loading'}`}
        style={style}
        loading="lazy"
        decoding="async"
        width={w}
        height={h}
        onLoad={() => setLoaded(image)}
        onError={() => setFailed((cur) => new Set(cur).add(image))}
      />
    );
  }

  if (place.photo) {
    return (
      <span className="landmark-thumb-wrap" style={style}>
        <img
          src={place.photo.url}
          alt={landmark.name}
          className="landmark-thumb"
          style={style}
          loading="lazy"
          decoding="async"
          width={w}
          height={h}
          referrerPolicy="no-referrer"
          onError={place.onError}
        />
        <PlacePhotoCredit photo={place.photo} compact={w < 160} />
      </span>
    );
  }

  const palette = paletteFor(landmark.id);
  return (
    <div
      ref={place.ref}
      className="landmark-thumb landmark-thumb-fallback"
      style={{ ...style, background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})` }}
    >
      <span style={{ fontSize: Math.min(w, h) * 0.4 }}>{iconFor(landmark.categories)}</span>
    </div>
  );
}
