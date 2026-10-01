import { useEffect, useState } from 'react';

const STORAGE_KEY = 'lh-zoom-radius-miles';
const DEFAULT_RADIUS = 5;
export const ZOOM_RADIUS_OPTIONS = [1, 2, 5, 10, 25, 50, 100];

// scope: the Test tab keeps its own remembered radius ('test'), so it starts
// at the default instead of inheriting whatever the real Map was left on.
const keyFor = (scope) => (scope ? `${STORAGE_KEY}:${scope}` : STORAGE_KEY);

function getInitialRadius(scope) {
  try {
    const stored = Number(localStorage.getItem(keyFor(scope)));
    return ZOOM_RADIUS_OPTIONS.includes(stored) ? stored : DEFAULT_RADIUS;
  } catch {
    return DEFAULT_RADIUS; // storage blocked
  }
}

export function useZoomRadius(scope = null) {
  const [radiusMiles, setRadiusMiles] = useState(() => getInitialRadius(scope));

  useEffect(() => {
    try {
      localStorage.setItem(keyFor(scope), String(radiusMiles));
    } catch {
      /* storage full or blocked */
    }
  }, [radiusMiles, scope]);

  return [radiusMiles, setRadiusMiles];
}
