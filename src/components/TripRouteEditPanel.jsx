import { useEffect, useRef, useState } from 'react';
import { useDragReorder } from '../lib/useDragReorder';
import { Spring, SPRING, project, rubberband } from '../screens/newUISpring';
import { legColor } from '../lib/tripLegs';
import { DragHandle } from './EditListControls';

// The Map's route editor (owner, 2026-11-22). "Get directions" on an
// itinerary opens the Map with the route in edit mode: every stop's name
// shows by its pin, tapping a pin takes it off the route (tap again to put
// it back), "Select all" puts every stop back, and the grip on each row
// drags it to a new place in the order. Save ends edit mode, writes the new
// order back to the itinerary (with Undo), and the pins open their usual
// card again. Cancel leaves without saving.
//
// Collapsible (owner, 2026-11-23): the grabber at the top folds the panel
// down to one bar, "Edit route: <trip>" and the stop count, so the map and
// its pins show while editing; tap or drag it back up to open it. Only the
// panel folds: the route edits live in the Map screen and edit mode stays
// on. The drag follows the finger 1:1 and the flick's projected landing
// point decides (newUISpring.js), springing from wherever it is.
//   stops: every stop the route started with ({ id, name }), in order
//   ids: the stops on the route now, in route order
export default function TripRouteEditPanel({ name, stops, ids, onReorder, onSelectAll, onSave, onCancel }) {
  const byId = Object.fromEntries(stops.map((s) => [s.id, s]));
  const { order, registerNode, startDrag, keyReorder, draggingId, dragY, shifts } = useDragReorder(ids, onReorder);
  const shown = order.filter((id) => byId[id]);
  const allIn = ids.length === stops.length;
  const count = `${ids.length} of ${stops.length} stop${stops.length === 1 ? '' : 's'}`;

  // open: what the panel is (or is heading to). The body's height is
  // driven by a spring while it moves and is 'auto' once it's open.
  const [open, setOpen] = useState(true);
  const bodyRef = useRef(null);
  const spring = useRef(null);
  const drag = useRef(null);
  const springOf = () => {
    if (!spring.current) spring.current = new Spring(0, (v) => bodyRef.current && (bodyRef.current.style.height = `${Math.max(0, v)}px`));
    return spring.current;
  };
  useEffect(() => () => spring.current?.stop(), []);
  const fullHeight = () => bodyRef.current?.scrollHeight || 0;
  const nowHeight = () => bodyRef.current?.getBoundingClientRect().height || 0;

  const settle = (toOpen, velocity = 0) => {
    const el = bodyRef.current;
    setOpen(toOpen);
    if (!el) return;
    const s = springOf();
    if (s.frame == null) s.value = nowHeight();
    s.to(toOpen ? fullHeight() : 0, {
      ...(Math.abs(velocity) > 300 ? SPRING.sheetFlick : SPRING.sheet),
      velocity,
      done: () => {
        if (toOpen && bodyRef.current) bodyRef.current.style.height = '';
      },
    });
  };
  const toggle = () => {
    if (drag.current?.moved) return;
    settle(!open);
  };

  // Grab the grabber (or the folded bar) and drag: down folds, up opens.
  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    const el = bodyRef.current;
    if (!el) return;
    springOf().stop();
    drag.current = {
      y: e.clientY,
      start: nowHeight(),
      full: fullHeight(),
      moved: false,
      samples: [[e.timeStamp, e.clientY]],
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    d.samples = [...d.samples.slice(-4), [e.timeStamp, e.clientY]];
    let h = d.start - dy;
    if (h > d.full) h = d.full + rubberband(h - d.full, d.full || 300);
    if (h < 0) h = -rubberband(-h, 300);
    springOf().set(h);
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.moved) {
      const [t0, y0] = d.samples[0];
      const dt = Math.max(1, e.timeStamp - t0) / 1000;
      const vy = (e.clientY - y0) / dt; // px/s, down is +
      const landing = nowHeight() - project(vy);
      settle(landing > d.full / 2, -vy);
      // The click that follows a drag must not toggle again.
      setTimeout(() => (drag.current = null), 0);
      return;
    }
    drag.current = null;
  };
  const grab = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  };

  return (
    <div className="map-nav-sheet">
      <div className={`card turn-panel trip-route-panel trip-route-edit${open ? '' : ' trip-route-edit-folded'}`}>
        <button
          type="button"
          className="trip-route-grabber"
          aria-expanded={open}
          aria-label={open ? 'Fold the route list to see the map' : 'Open the route list'}
          onClick={toggle}
          {...grab}
        >
          <span className="trip-route-grabber-bar" aria-hidden="true" />
        </button>
        <div className="turn-panel-head">
          <h3 style={{ margin: 0 }} onClick={open ? undefined : toggle} {...(open ? {} : grab)}>
            Edit route: {name}
            {!open && <span className="trip-route-edit-folded-count">{count}</span>}
          </h3>
          {open ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
          ) : (
            <button type="button" className="trip-route-chevron" aria-label="Open the route list" onClick={toggle}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="trip-route-edit-body" ref={bodyRef} inert={!open} aria-hidden={open ? undefined : true}>
          <p className="screen-subtitle trip-route-edit-hint">Tap a pin to drop it. Drag ☰ to reorder.</p>
          <div className="trip-route-edit-actions">
            <span className="trip-route-edit-count">{count}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onSelectAll} disabled={allIn}>
              Select all
            </button>
          </div>
          {shown.length ? (
            <ol className="turn-steps trip-route-steps trip-route-edit-list">
              {shown.map((id, i) => (
                <li
                  key={id}
                  ref={registerNode(id)}
                  className={draggingId === id ? 'dragging' : ''}
                  style={{
                    transform: `translateY(${draggingId === id ? dragY : shifts[id] || 0}px)`,
                    transition: draggingId === id ? 'none' : 'transform 150ms ease',
                    position: 'relative',
                    zIndex: draggingId === id ? 20 : 1,
                  }}
                >
                  <span>
                    <strong style={{ color: legColor(i + 1) }}>{i + 1}.</strong> {byId[id].name}
                  </span>
                  <DragHandle className="drag-handle-end" name={byId[id].name} onPointerDown={startDrag(id)} onKeyDown={keyReorder(id)} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="screen-subtitle">No stops on the route. Tap a pin or Select all to add them back.</p>
          )}
          <button type="button" className="btn btn-primary btn-block trip-route-save" onClick={onSave} disabled={!ids.length}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
