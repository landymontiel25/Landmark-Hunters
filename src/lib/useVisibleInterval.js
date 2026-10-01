import { useEffect, useRef } from 'react';

// setInterval that only runs while the page is visible. A once-a-second
// countdown kept ticking (and re-rendering) all day in a backgrounded tab or
// a phone in a pocket, which is wasted battery and heat. When the page comes
// back it ticks once immediately so the number is right before the first
// interval fires.
export function useVisibleInterval(callback, ms, active = true) {
  const cb = useRef(callback);
  cb.current = callback;
  useEffect(() => {
    if (!active) return undefined;
    let id = null;
    const start = () => {
      if (id == null) id = setInterval(() => cb.current(), ms);
    };
    const stop = () => {
      if (id != null) {
        clearInterval(id);
        id = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        cb.current();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms, active]);
}
