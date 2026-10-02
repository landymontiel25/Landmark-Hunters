import { useEffect, useState } from 'react';
import { loadPlacePhoto, peekPlacePhoto, placePhotoKey } from './placePhoto';

/**
 * Fallback photo for a landmark with no image of its own. Attach the
 * returned `ref` to the placeholder tile: nothing is fetched until that
 * element scrolls into view, and `enabled` must be false whenever the
 * landmark already has a photo (so those never cost a request).
 *
 * lookup: false never starts a Google lookup (dense lists of imported
 * places); it still shows a photo already fetched this session.
 *
 * Returns { ref, photo, onError }: photo is {url, attributions} or null.
 * Call onError from the <img> so a dead URL drops back to the placeholder.
 */
export function usePlacePhoto(landmark, { enabled = true, lookup = true } = {}) {
  const key = placePhotoKey(landmark);
  const active = enabled && lookup && !!key;
  const [node, setNode] = useState(null);
  const [visibleKey, setVisibleKey] = useState(null);
  const [state, setState] = useState({ key: null, photo: null });
  const [brokenUrl, setBrokenUrl] = useState(null);

  const visible = active && visibleKey === key;

  useEffect(() => {
    if (!active || visible || !node) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisibleKey(key);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleKey(key);
          io.disconnect();
        }
      },
      { rootMargin: '150px' }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [active, visible, node, key]);

  useEffect(() => {
    if (!visible) return undefined;
    if (peekPlacePhoto(landmark) !== undefined) {
      setState({ key, photo: peekPlacePhoto(landmark) });
      return undefined;
    }
    let cancelled = false;
    loadPlacePhoto(landmark).then((photo) => {
      if (!cancelled) setState({ key, photo });
    });
    return () => {
      cancelled = true;
    };
    // landmark identity is captured by `key` (name + coordinates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key]);

  // lookup: false shows a photo this session already fetched, never a new one.
  const known = enabled && !lookup && key ? peekPlacePhoto(landmark) : null;
  const fetched = active && state.key === key ? state.photo : null;
  const photo = [fetched, known].find((p) => p && p.url !== brokenUrl) || null;
  return { ref: setNode, photo, onError: () => photo && setBrokenUrl(photo.url) };
}
