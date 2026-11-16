import { useEffect, useState } from 'react';
import { loadPlacePhoto, peekPlacePhoto, placePhotoKey, placePhotoRetryInMs } from './placePhoto';

/**
 * Fallback photo for a landmark with no image of its own. Attach the
 * returned `ref` to the placeholder tile: nothing is fetched until that
 * element scrolls into view, and `enabled` must be false whenever the
 * landmark already has a photo (so those never cost a request).
 *
 * lookup: false never starts a Google lookup (dense lists of imported
 * places); it still shows a photo already fetched this session.
 *
 * Returns { ref, photo, missing, onError }: photo is {url, attributions} or
 * null. `missing` is true once the lookup has finished and found nothing (or
 * its photo failed to load), so the tile can say "No image available"; it
 * stays false while the lookup is pending or never runs.
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
      // Starts a little before the tile scrolls in, so the photo is there
      // when it arrives (owner, 2026-11-08).
      { rootMargin: '400px' }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [active, visible, node, key]);

  // Bumped to ask again once paused lookups resume (owner, 2026-11-16).
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    let retry = null;
    const settle = (photo) => {
      if (cancelled) return;
      setState({ key, photo });
      const wait = !photo && placePhotoRetryInMs();
      if (wait) retry = setTimeout(() => setAttempt((n) => n + 1), wait + 600);
    };
    const known = peekPlacePhoto(landmark);
    if (known !== undefined) {
      Promise.resolve(known).then(settle);
    } else {
      loadPlacePhoto(landmark).then(settle);
    }
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
    // landmark identity is captured by `key` (name + coordinates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key, attempt]);

  // lookup: false shows a photo this session already fetched, never a new one.
  const known = enabled && !lookup && key ? peekPlacePhoto(landmark) : null;
  const fetched = active && state.key === key ? state.photo : null;
  const photo = [fetched, known].find((p) => p && p.url !== brokenUrl) || null;
  const missing = active && !photo && (state.key === key || brokenUrl !== null);
  return { ref: setNode, photo, missing, onError: () => photo && setBrokenUrl(photo.url) };
}
