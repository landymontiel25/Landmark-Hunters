// How the Map's landmark card (a pin's popup) reacts to touches (owner,
// 2026-11-22):
//   - dragging on the card pans the map under it; the card stays open
//   - dragging anywhere on the map pans it; the card stays open
//   - only a TAP on empty map space closes the card (not on the card, not
//     on a pin): a quick touch that moved less than TAP_SLOP_PX
//   - tapping the card still opens its page; tapping another pin switches
// Leaflet's own "close on any map click" is turned off (closePopupOnClick)
// because it counted a short pan as a click.

export const TAP_SLOP_PX = 10;
export const TAP_MAX_MS = 500;

// Pure: is this touch a tap? (start/end: { x, y, t })
export function isTap(start, end, { slop = TAP_SLOP_PX, maxMs = TAP_MAX_MS } = {}) {
  if (!start || !end) return false;
  return Math.hypot(end.x - start.x, end.y - start.y) < slop && end.t - start.t <= maxMs;
}

// What a touch started on. Pins (and cluster bubbles) and controls are
// never "empty map".
export function touchTarget(el) {
  if (!el?.closest) return 'other';
  if (el.closest('.leaflet-popup')) return 'card';
  if (el.closest('.leaflet-marker-icon, .leaflet-marker-shadow, .leaflet-control, .leaflet-tooltip-pane .leaflet-interactive')) return 'pin';
  if (el.closest('.leaflet-interactive')) return 'pin';
  return 'map';
}

// Wires it up on a Leaflet map. Returns a cleanup function.
export function attachMapCardGestures(map, { slop = TAP_SLOP_PX } = {}) {
  const box = map.getContainer();
  const touches = new Map(); // pointerId -> { x, y, t, on }
  let cardDrag = null; // { id, x, y, moved } while a drag that began on the card is live
  let swallowClick = false;

  const onDown = (e) => {
    const on = touchTarget(e.target);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), on });
    if (on === 'card' && touches.size === 1) cardDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    else cardDrag = null;
  };
  const onMove = (e) => {
    if (!cardDrag || e.pointerId !== cardDrag.id) return;
    const start = touches.get(e.pointerId);
    if (!cardDrag.moved && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < slop) return;
    if (!cardDrag.moved) {
      cardDrag.moved = true;
      // From here it's a pan, not a tap: the card's own click won't fire.
      try {
        box.setPointerCapture?.(e.pointerId);
      } catch {
        /* pointer already gone */
      }
    }
    map.panBy([cardDrag.x - e.clientX, cardDrag.y - e.clientY], { animate: false });
    cardDrag.x = e.clientX;
    cardDrag.y = e.clientY;
    e.preventDefault();
  };
  const onUp = (e) => {
    const start = touches.get(e.pointerId);
    const many = touches.size > 1; // a pinch is never a tap
    touches.delete(e.pointerId);
    if (cardDrag && e.pointerId === cardDrag.id) {
      if (cardDrag.moved) {
        swallowClick = true;
        // Only the click that ends this drag; none may come at all.
        setTimeout(() => {
          swallowClick = false;
        }, 400);
      }
      cardDrag = null;
      return;
    }
    if (!start || many || start.on !== 'map' || e.type === 'pointercancel') return;
    if (isTap(start, { x: e.clientX, y: e.clientY, t: performance.now() }, { slop })) map.closePopup();
  };
  // A drag that began on the card ends in a click on whatever is under the
  // finger: swallow it, so a pan never opens the landmark page.
  const onClick = (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  box.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, { capture: true, passive: false });
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  box.addEventListener('click', onClick, true);
  return () => {
    box.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    box.removeEventListener('click', onClick, true);
  };
}
