import { useEffect, useState } from 'react';
import { loadLandmarkRatings } from './landmarkRatings';

/**
 * Outside ratings for one landmark. Nothing is fetched until the element
 * holding `ref` scrolls near the viewport (lazy: true, for list cards), or
 * right away (lazy: false, the detail screen). `enabled: false` never
 * fetches.
 *
 * Returns { ref, status, sources }: status is 'idle' (not on screen yet),
 * 'loading' or 'done'; sources is { google, tripadvisor } once done.
 */
export function useLandmarkRatings(landmark, { detail = false, lazy = true, enabled = true } = {}) {
  const key = landmark?.id ? `${landmark.regionId ?? landmark.region}/${landmark.id}|${detail ? 1 : 0}` : null;
  const [node, setNode] = useState(null);
  const [visibleKey, setVisibleKey] = useState(null);
  const [state, setState] = useState({ key: null, sources: null });
  const active = enabled && !!key;
  const visible = active && (!lazy || visibleKey === key);

  useEffect(() => {
    if (!active || !lazy || visible || !node) return undefined;
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
      { rootMargin: '100px' }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [active, lazy, visible, node, key]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    loadLandmarkRatings(landmark, { detail }).then((sources) => {
      if (!cancelled) setState({ key, sources });
    });
    return () => {
      cancelled = true;
    };
    // landmark identity is captured by `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key]);

  const done = state.key === key && !!state.sources;
  return {
    ref: setNode,
    status: !active ? 'off' : done ? 'done' : visible ? 'loading' : 'idle',
    sources: done ? state.sources : null,
  };
}
