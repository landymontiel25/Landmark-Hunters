import { useEffect, useRef, useState } from 'react';

// Manual hold-and-drag reordering (the grip handle you press and drag, same
// idea as iOS Weather's city list) for both the solo Itinerary route and
// Group Trip's shared landmarks -- shared here so both use the exact same
// drag math instead of two copies drifting apart. Pointer Events cover
// mouse and touch alike, so no drag-and-drop library is needed.
//
// The dragged row tracks the pointer directly (a raw translateY, no
// transition) while every other row animates smoothly into the slot it
// would land in if you dropped right now -- the classic "make room" reorder
// feel, not a teleport. The underlying `order` array only changes once, on
// release; rows are visually shifted with CSS transforms the whole time
// they're being dragged past, using each row's own real height (captured at
// drag start via getBoundingClientRect), so it holds up with the variable-
// height cards here, not just a uniform list like Weather's.
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
  // Pixels: how far the dragged row has moved from where it started.
  const [dragY, setDragY] = useState(0);
  // Pixels: how far each OTHER row has shifted to make room, id -> px.
  const [shifts, setShifts] = useState({});
  const startYRef = useRef(0);
  const startRectsRef = useRef([]); // [{ id, top, height }], captured at drag start
  const gapRef = useRef(10);
  const finalOrderRef = useRef(ids);

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

  // Where the dragged row's CENTER now sits among the others' ORIGINAL
  // centers (not their live, already-shifted ones -- comparing against a
  // moving target would fight itself).
  const orderFor = (pointerY) => {
    const others = startRectsRef.current.filter((r) => r.id !== dragId.current);
    let insertAt = others.length;
    for (let i = 0; i < others.length; i++) {
      if (pointerY < others[i].top + others[i].height / 2) {
        insertAt = i;
        break;
      }
    }
    const finalIds = others.map((r) => r.id);
    finalIds.splice(insertAt, 0, dragId.current);
    return finalIds;
  };

  // Shifts every other row from its ORIGINAL top to the top it would have
  // in `finalIds`, so they visually slide into the gap the drag opened up.
  const applyShifts = (finalIds) => {
    const byId = Object.fromEntries(startRectsRef.current.map((r) => [r.id, r]));
    const top0 = startRectsRef.current.reduce((min, r) => Math.min(min, r.top), Infinity);
    let cursor = top0;
    const newTop = {};
    for (const id of finalIds) {
      newTop[id] = cursor;
      cursor += (byId[id]?.height || 0) + gapRef.current;
    }
    const next = {};
    for (const id of finalIds) {
      if (id !== dragId.current) next[id] = newTop[id] - byId[id].top;
    }
    setShifts(next);
  };

  const startDrag = (id) => (e) => {
    // Only the primary button/touch, and don't hijack normal taps elsewhere.
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    dragId.current = id;
    setDraggingId(id);
    setDragY(0);
    startYRef.current = e.clientY;
    const target = e.currentTarget;
    target.setPointerCapture?.(e.pointerId);

    const rects = orderRef.current
      .map((itemId) => {
        const node = nodesRef.current[itemId];
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { id: itemId, top: r.top, height: r.height };
      })
      .filter(Boolean);
    startRectsRef.current = rects;
    // Infer the real gap between rows from the first adjacent pair; a
    // 1-row list has nothing to infer from, so keep the fallback.
    if (rects.length >= 2) {
      gapRef.current = Math.max(0, rects[1].top - (rects[0].top + rects[0].height));
    }
    finalOrderRef.current = orderRef.current;

    const onMove = (ev) => {
      setDragY(ev.clientY - startYRef.current);
      const finalIds = orderFor(ev.clientY);
      finalOrderRef.current = finalIds;
      applyShifts(finalIds);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const finalIds = finalOrderRef.current;
      dragId.current = null;
      setDraggingId(null);
      setDragY(0);
      setShifts({});
      orderRef.current = finalIds;
      setOrder(finalIds);
      onReorder(finalIds);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return { order, registerNode, startDrag, draggingId, dragY, shifts };
}
