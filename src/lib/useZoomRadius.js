import { useEffect, useState } from 'react';

const STORAGE_KEY = 'lh-zoom-radius-miles';
const DEFAULT_RADIUS = 5;
export const ZOOM_RADIUS_OPTIONS = [1, 2, 5, 10, 25, 50, 100];

function getInitialRadius() {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return ZOOM_RADIUS_OPTIONS.includes(stored) ? stored : DEFAULT_RADIUS;
  } catch {
    return DEFAULT_RADIUS; // storage blocked
  }
}

export function useZoomRadius() {
  const [radiusMiles, setRadiusMiles] = useState(getInitialRadius);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(radiusMiles));
    } catch {
      /* storage full or blocked */
    }
  }, [radiusMiles]);

  return [radiusMiles, setRadiusMiles];
}
