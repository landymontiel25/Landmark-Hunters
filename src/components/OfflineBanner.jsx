import { useLayoutEffect, useRef } from 'react';
import { useOnlineStatus } from '../lib/useOnlineStatus';

// Sticky at the top, above the full-screen map: in the normal flow it sat
// under the Map tab's map (so the Map never said it was offline) while still
// pushing the header down onto the map's floating "Finish the swipe cards"
// banner. It sets --offline-h to its height; --header-base (and the header's
// own sticky top) add it, so the header and everything placed under it
// moves down by exactly the banner. Found by the app simulation
// (docs/app-sim-results.md).
export default function OfflineBanner() {
  const online = useOnlineStatus();
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (online) return undefined;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--offline-h', `${ref.current?.offsetHeight || 0}px`);
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    if (ro && ref.current) ro.observe(ref.current);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--offline-h');
    };
  }, [online]);

  if (online) return null;

  return (
    <div
      ref={ref}
      role="status"
      className="offline-banner"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1150,
        background: 'var(--color-error, #b3503f)',
        color: '#fff',
        textAlign: 'center',
        fontSize: '0.82rem',
        fontWeight: 600,
        padding: '8px 12px',
      }}
    >
      {'\u{1F4F6}'} You're offline — some lists may look empty or out of date until you're back online.
    </div>
  );
}
