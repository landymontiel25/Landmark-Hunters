import { useState } from 'react';
import { paletteFor, iconFor } from '../lib/landmarkVisuals';

// swipeable: renders a horizontal scroll-snap gallery with dot indicators
// when the landmark has more than one photo. Non-swipeable contexts (list
// rows, popups, itinerary stops) just show the first photo as a static
// thumbnail so swipe gestures there don't fight the surrounding scroll.
//
// myPhotos: the signed-in viewer's own check-in photo(s) for this landmark,
// if any -- put first, ahead of the landmark's regular photos, so your own
// shot becomes the cover picture just for you. onImageClick (if given) opens
// a photo full-screen instead of just displaying it inline.
//
// A photo that fails to load is dropped from the set (so a gallery never
// shows a broken-image icon); if none load, the colored category card shows
// instead. Photos shimmer softly until they arrive.
export default function LandmarkPostcard({ landmark, size = 'md', rotate = 'l', swipeable = false, myPhotos, onImageClick }) {
  const palette = paletteFor(landmark.id);
  const icon = iconFor(landmark.categories);
  const dims =
    size === 'sm' ? { width: 150, height: 105 } : size === 'lg' ? { width: 320, height: 220 } : { width: 220, height: 150 };
  // The big postcard is a fixed 320px, which (plus its border) is wider than
  // the page on a 320px phone and pushed the whole screen sideways.
  dims.width = `min(${dims.width}px, calc(100vw - 60px))`;
  const [failed, setFailed] = useState(() => new Set());
  const [loaded, setLoaded] = useState(() => new Set());
  const allImages = [...(myPhotos || []), ...(landmark.images || [])].filter((src) => !failed.has(src));
  const images = allImages.length ? allImages : null;
  const [activeIdx, setActiveIdx] = useState(0);
  const imgProps = (src) => ({
    className: `postcard-photo ${loaded.has(src) ? '' : 'img-loading'}`,
    onLoad: () => setLoaded((cur) => new Set(cur).add(src)),
    onError: () => setFailed((cur) => new Set(cur).add(src)),
  });

  const handleScroll = (e) => {
    const idx = Math.round(e.target.scrollLeft / e.target.clientWidth);
    setActiveIdx(idx);
  };

  let body;
  if (images && swipeable && images.length > 1) {
    body = (
      <div className="postcard-gallery" style={{ width: dims.width, height: dims.height }}>
        <div className="postcard-gallery-scroll" onScroll={handleScroll}>
          {images.map((src, i) => (
            <img
              key={src}
              src={src}
              alt={`${landmark.name} photo ${i + 1} of ${images.length}`}
              {...imgProps(src)}
              style={{ width: dims.width, height: dims.height, cursor: onImageClick ? 'zoom-in' : undefined }}
              loading="lazy"
              onClick={onImageClick ? () => onImageClick(src) : undefined}
            />
          ))}
        </div>
        <div className="postcard-gallery-dots">
          {images.map((_, i) => (
            <span key={i} className={`postcard-gallery-dot ${i === activeIdx ? 'active' : ''}`} />
          ))}
        </div>
      </div>
    );
  } else if (images) {
    body = (
      <img
        src={images[0]}
        alt={landmark.name}
        {...imgProps(images[0])}
        style={{ width: dims.width, height: dims.height, cursor: onImageClick ? 'zoom-in' : undefined }}
        loading="lazy"
        onClick={onImageClick ? () => onImageClick(images[0]) : undefined}
      />
    );
  } else {
    body = (
      <div
        className="postcard-photo"
        style={{
          width: dims.width,
          height: dims.height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`,
        }}
      >
        <span style={{ fontSize: size === 'lg' ? '2.6rem' : '1.8rem', filter: 'grayscale(0.15)' }}>{icon}</span>
      </div>
    );
  }

  return <div className={`postcard ${rotate === 'r' ? 'rot-r' : ''}`}>{body}</div>;
}
