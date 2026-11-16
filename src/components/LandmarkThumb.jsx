import { useEffect, useState } from 'react';
import { usePlacePhoto } from '../lib/usePlacePhoto';
import PlacePhotoCredit from './PlacePhotoCredit';
import { isPermanentlyClosed } from '../lib/closedPlace';

// Compact, non-swipeable thumbnail for dense contexts (list rows, itinerary
// stops, map popups) where the decorative postcard frame doesn't fit.
//
// myPhoto: the signed-in viewer's own check-in photo for this landmark, if
// any -- shown instead of the landmark's default photo, just for them.
//
// A photo that fails to load (deleted upload, dead link, offline) falls
// through to the next one, then to Google's photo -- never the browser's
// broken-image icon or a category icon. It shimmers softly while loading.
//
// A landmark with no photo left to show (none stored, or every one failed)
// lazily asks for a Google Places photo once the tile scrolls into view (see
// docs/photos.md), shown with its required "Photo: <author> via Google Maps"
// credit; only when Google has none too does the colored tile stay.
// A place closed for good wears a CLOSED band across its thumbnail.
export default function LandmarkThumb(props) {
  if (!isPermanentlyClosed(props.landmark)) return <Thumb {...props} />;
  return (
    <span className="landmark-thumb-wrap">
      <Thumb {...props} />
      <span className="landmark-thumb-closed">CLOSED</span>
    </span>
  );
}

// How long a photo on screen may stall before the next one is tried.
const STUCK_MS = 12000;
// No IntersectionObserver (old browsers, tests): every photo counts as on screen.
const NO_IO = typeof IntersectionObserver === 'undefined';

function Thumb({ landmark, size = 52, width, height, myPhoto }) {
  const [failed, setFailed] = useState(() => new Set());
  const [loaded, setLoaded] = useState(null);
  const [imgNode, setImgNode] = useState(null);
  const [onScreen, setOnScreen] = useState(null);
  const image = [myPhoto, ...(landmark.images || [])].find((src) => src && !failed.has(src));
  // Imported places look up their Google photo in lists too (owner,
  // 2026-11-08: photos must be there before you tap). Only tiles on or near
  // the screen ask (usePlacePhoto), and the server's place-ID cache keeps
  // repeat views off the Text Search quota (docs/photos.md). Since
  // 2026-11-15 also when every stored photo failed, not only when there are
  // none: no landmark is left on a placeholder when Google has a photo.
  const place = usePlacePhoto(landmark, { enabled: !image });
  const w = width ?? size;
  const h = height ?? size;
  const style = { width: w, height: h };

  // A lazy photo isn't requested until it nears the screen, so the stall
  // timer starts only once it's there (owner, 2026-11-15). Before, the 8 s
  // ran from the moment the row rendered: photos further down a list or an
  // itinerary timed out before the browser ever asked for them, one by one,
  // and the card fell back to an icon (Bayfront Park, Zoo Miami, Hard Rock
  // Stadium all have photos).
  useEffect(() => {
    if (!imgNode || !image || NO_IO) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setOnScreen(image);
          io.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    io.observe(imgNode);
    return () => io.disconnect();
  }, [imgNode, image]);

  // A photo on screen still loading after 12 s (a stalled host) gives way to
  // the next one, then Google's, so a row is never a blank box (owner,
  // 2026-11-14).
  useEffect(() => {
    if (!image || loaded === image || (!NO_IO && onScreen !== image)) return undefined;
    const t = setTimeout(() => setFailed((cur) => new Set(cur).add(image)), STUCK_MS);
    return () => clearTimeout(t);
  }, [image, loaded, onScreen]);

  if (image) {
    return (
      <img
        ref={setImgNode}
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

  // No category icon, ever (owner, 2026-11-16): a quiet shimmer while the
  // photo is on its way, and only if neither Wikimedia nor Google has one,
  // a plain "No photo yet".
  return (
    <div ref={place.ref} className={`landmark-thumb landmark-thumb-fallback photo-tile ${place.missing ? 'is-none' : 'is-pending'}`} style={style}>
      {place.missing && w >= 96 && <span className="no-image-label">No photo yet</span>}
    </div>
  );
}
