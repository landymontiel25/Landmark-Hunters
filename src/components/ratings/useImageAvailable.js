import { useEffect, useState } from 'react';

// 'pending' | 'ok' | 'missing' for an image URL. Used for the brand logos a
// source's attribution rules require: if the logo file is missing, that
// source's rating is not shown at all. One check per URL per page, shared
// by every row, so a long list doesn't load the logo once per card.
const known = new Map(); // src -> 'ok' | 'missing'
const checks = new Map(); // src -> Promise<'ok' | 'missing'>

function check(src) {
  if (!checks.has(src)) {
    checks.set(
      src,
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve('ok');
        img.onerror = () => resolve('missing');
        img.src = src;
      }).then((v) => {
        known.set(src, v);
        return v;
      })
    );
  }
  return checks.get(src);
}

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
    check(src).then((v) => alive && setState(v));
    return () => {
      alive = false;
    };
  }, [src]);
  return state;
}
