import { useEffect, useRef, useState } from 'react';

// Manual hold-and-drag reordering (the grip handle you press and drag, same
// idea as iOS Weather's city list) for both the solo Itinerary route and
// Group Trip's shared landmarks -- shared here so both use the exact same
// drag math instead of two copies drifting apart. Pointer Events cover
// mouse and touch alike, so no drag-and-drop library is needed.
//
// `ids`: the current order from whoever owns the data (Firestore/local
// state). `onReorder(newIds)` is called once, on release, with the final
// order -- nothing is persisted mid-drag.
export function useDragReorder(ids, onReorder) {
  const [order, setOrder] = useState(ids);
  const orderRef = useRef(ids);
  const dragId = useRef(null);
  const [draggingId, setDraggingId] = useState(null);
  const nodesRef = useRef({});

  // Re-sync to the source of truth whenever the underlying set of ids
  // changes (a landmark added/removed) -- but not while a drag is in
  // flight, so an in-progress drag never gets clobbered by its own
  // eventual write-back.
  const idsKey = ids.join('|');
  useEffect(() => {
    if (dragId.current) return;
    setOrder(ids);
    orderRef.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const registerNode = (id) => (node) => {
    if (node) nodesRef.current[id] = node;
    else delete nodesRef.current[id];
  };

  const reorderTo = (pointerY) => {
    const cur = orderRef.current;
    const from = cur.indexOf(dragId.current);
    if (from < 0) return;
    let to = cur.length - 1;
    for (let i = 0; i < cur.length; i++) {
      const node = nodesRef.current[cur[i]];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (pointerY < rect.top + rect.height / 2) {
        to = i;
        break;
      }
    }
    if (to === from) return;
    const next = [...cur];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    orderRef.current = next;
    setOrder(next);
  };

  const startDrag = (id) => (e) => {
    // Only the primary button/touch, and don't hijack normal taps elsewhere.
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    dragId.current = id;
    setDraggingId(id);
    const target = e.currentTarget;
    target.setPointerCapture?.(e.pointerId);

    const onMove = (ev) => reorderTo(ev.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      dragId.current = null;
      setDraggingId(null);
      onReorder(orderRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return { order, registerNode, startDrag, draggingId };
}
