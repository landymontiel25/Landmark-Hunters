import { useEffect, useState } from 'react';
import { loadPlacePhoto, peekPlacePhoto, placePhotoKey } from './placePhoto';

/**
 * Fallback photo for a landmark with no image of its own. Attach the
 * returned `ref` to the placeholder tile: nothing is fetched until that
 * element scrolls into view, and `enabled` must be false whenever the
 * landmark already has a photo (so those never cost a request).
 *
 * Returns { ref, photo, onError }: photo is {url, attributions} or null.
 * Call onError from the <img> so a dead URL drops back to the placeholder.
 */
export function usePlacePhoto(landmark, { enabled = true } = {}) {
  const key = placePhotoKey(landmark);
  const active = enabled && !!key;
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

  const photo = active && state.key === key && state.photo && state.photo.url !== brokenUrl ? state.photo : null;
  return { ref: setNode, photo, onError: () => photo && setBrokenUrl(photo.url) };
}
