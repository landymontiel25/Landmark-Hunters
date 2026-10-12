import { useRef, useState } from 'react';

// Zillow-style "draw an area": while this sits over the map, the map stops
// panning and a finger (or mouse) traces a shape. Lifting it closes the shape
// and hands back its outline as [lat, lng] points; a tap or a scribble too
// small to be an area is ignored so you can try again.
export default function MapDrawOverlay({ map, onDone, onCancel }) {
  const [points, setPoints] = useState([]);
  const drawing = useRef(false);
  const boxRef = useRef(null);

  const local = (e) => {
    const r = boxRef.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const start = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    setPoints([local(e)]);
  };

  const move = (e) => {
    if (!drawing.current) return;
    const p = local(e);
    setPoints((cur) => {
      const last = cur[cur.length - 1];
      // Every 6 px is plenty of detail and keeps the outline light.
      return last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 6 ? cur : [...cur, p];
    });
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const big = points.length >= 4 && Math.max(...xs) - Math.min(...xs) > 30 && Math.max(...ys) - Math.min(...ys) > 30;
    if (!big || !map) {
      setPoints([]);
      return;
    }
    // Overlay points are in the map container's pixels (both fill the same box).
    const mapBox = map.getContainer().getBoundingClientRect();
    const box = boxRef.current.getBoundingClientRect();
    const ring = points.map(([x, y]) => {
      const ll = map.containerPointToLatLng([x + box.left - mapBox.left, y + box.top - mapBox.top]);
      return [Math.round(ll.lat * 1e6) / 1e6, Math.round(ll.lng * 1e6) / 1e6];
    });
    setPoints([]);
    onDone(ring);
  };

  return (
    <div
      ref={boxRef}
      className="map-draw-overlay"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      role="application"
      aria-label="Draw an area on the map with your finger"
    >
      <svg className="map-draw-svg" aria-hidden="true">
        {points.length > 1 && <polyline points={points.map((p) => p.join(',')).join(' ')} />}
      </svg>
      {points.length === 0 && <p className="map-draw-hint">Draw a shape around the area you want</p>}
      <button
        type="button"
        className="btn btn-ghost btn-sm map-draw-cancel"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}
