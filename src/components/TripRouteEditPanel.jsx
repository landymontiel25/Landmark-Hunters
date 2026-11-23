import { useDragReorder } from '../lib/useDragReorder';
import { legColor } from '../lib/tripLegs';
import { DragHandle } from './EditListControls';

// The Map's route editor (owner, 2026-11-22). "Get directions" on an
// itinerary opens the Map with the route in edit mode: every stop's name
// shows by its pin, tapping a pin takes it off the route (tap again to put
// it back), "Select all" puts every stop back, and the grip on each row
// drags it to a new place in the order. Save ends edit mode, writes the new
// order back to the itinerary (with Undo), and the pins open their usual
// card again. Cancel leaves without saving.
//   stops: every stop the route started with ({ id, name }), in order
//   ids: the stops on the route now, in route order
export default function TripRouteEditPanel({ name, stops, ids, onReorder, onSelectAll, onSave, onCancel }) {
  const byId = Object.fromEntries(stops.map((s) => [s.id, s]));
  const { order, registerNode, startDrag, keyReorder, draggingId, dragY, shifts } = useDragReorder(ids, onReorder);
  const shown = order.filter((id) => byId[id]);
  const allIn = ids.length === stops.length;
  return (
    <div className="map-nav-sheet">
      <div className="card turn-panel trip-route-panel trip-route-edit">
        <div className="turn-panel-head">
          <h3 style={{ margin: 0 }}>Edit route: {name}</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <p className="screen-subtitle trip-route-edit-hint">Tap a pin to drop it. Drag ☰ to reorder.</p>
        <div className="trip-route-edit-actions">
          <span className="trip-route-edit-count">
            {ids.length} of {stops.length} stop{stops.length === 1 ? '' : 's'}
          </span>
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
  );
}
