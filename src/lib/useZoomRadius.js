import { useEffect, useState } from 'react';

const DEFAULT_RADIUS = 5;
export const ZOOM_RADIUS_OPTIONS = [1, 2, 5, 10, 25, 50, 100];

// The Map opens at 5 mi every launch (owner, 2026-11-08). A choice lasts
// while the app stays open (hopping between tabs) and is never saved on the
// device, so closing the app goes back to 5.
// scope: the Test tab keeps its own value ('test'), so trying it never
// changes the real Map's distance.
const sessionRadius = new Map();

export function useZoomRadius(scope = null) {
  const key = scope || 'map';
  const [radiusMiles, setRadiusMiles] = useState(() => sessionRadius.get(key) ?? DEFAULT_RADIUS);
  useEffect(() => {
    sessionRadius.set(key, radiusMiles);
  }, [key, radiusMiles]);
  return [radiusMiles, setRadiusMiles];
}

// Tests only.
export function _resetZoomRadius() {
  sessionRadius.clear();
}
