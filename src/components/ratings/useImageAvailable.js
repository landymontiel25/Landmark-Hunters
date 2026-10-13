import { useEffect, useState } from 'react';

// 'pending' | 'ok' | 'missing' for an image URL. Used for the brand logos a
// source's attribution rules require: if the logo file is missing, that
// source's rating is not shown at all.
const known = new Map();

export function useImageAvailable(src) {
  const [state, setState] = useState(() => (src ? known.get(src) || 'pending' : 'missing'));
  useEffect(() => {
    if (!src) {
      setState('missing');
      return undefined;
    }
    if (known.has(src)) {
      setState(known.get(src));
      return undefined;
    }
    if (typeof Image === 'undefined') return undefined;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      known.set(src, 'ok');
      if (alive) setState('ok');
    };
    img.onerror = () => {
      known.set(src, 'missing');
      if (alive) setState('missing');
    };
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return state;
}
