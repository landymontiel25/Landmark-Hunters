import { useEffect, useRef } from 'react';
import { SHOWN_VISIBLE_RATIO } from '../lib/maprConstants';

// A div that calls onSeen once, the first time at least SHOWN_VISIBLE_RATIO
// of it scrolls into view. Without IntersectionObserver (old webviews, tests)
// it counts as seen as soon as it is rendered.
export default function OnScreen({ onSeen, children, ...rest }) {
  const el = useRef(null);
  const cb = useRef(onSeen);
  cb.current = onSeen;
  useEffect(() => {
    const node = el.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      cb.current?.();
      return undefined;
    }
    let done = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (done || !entries.some((e) => e.isIntersecting && e.intersectionRatio >= SHOWN_VISIBLE_RATIO)) return;
        done = true;
        io.disconnect();
        cb.current?.();
      },
      { threshold: [SHOWN_VISIBLE_RATIO] }
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={el} {...rest}>
      {children}
    </div>
  );
}
