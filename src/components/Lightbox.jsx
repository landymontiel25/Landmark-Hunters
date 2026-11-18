import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PlacePhotoCredit from './PlacePhotoCredit';

// Full-screen photo viewer: solid black, above everything (header and nav
// hidden), and the page behind it can't scroll while it's open. Pinch to zoom
// in and out (owner, 2026-11-18), drag to look around once zoomed, double-tap
// to zoom in or back out. The ✕ closes it; so does a tap beside the photo
// while it isn't zoomed. `credit` is a Google photo's { attributions } (its
// "via Google Maps" line has to show wherever the photo does).

export const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
// A finger that moves less than this is a tap, not a drag.
const TAP_SLOP = 10;

// Past a bound the photo follows the fingers less and less (Apple's rubber
// band), so the edge reads as "nothing more here", not a hard stop.
function rubber(value, min, max, dim) {
  if (value < min) return min - band(min - value, dim);
  if (value > max) return max + band(value - max, dim);
  return value;
}
const band = (over, dim) => (over * dim * 0.55) / (dim + 0.55 * over);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function Lightbox({ src, alt = 'Photo', credit = null, onClose }) {
  // A photo that can't load says so in words instead of a broken-image icon
  // on a black screen.
  const [failedSrc, setFailedSrc] = useState(null);
  // Held in a ref so a parent passing a fresh inline onClose each render
  // doesn't tear down and re-lock the page (and jump the scroll) every time.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // The photo's place: scale and offset (px from centered). `settling` turns
  // on the CSS spring for the animated moves (release, double tap).
  const [view, setView] = useState({ s: 1, x: 0, y: 0, settling: false });
  const viewRef = useRef(view);
  viewRef.current = view;
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const gesture = useRef({ pointers: new Map(), start: null, moved: false, lastTap: 0 });

  // Lock the page: iOS ignores overflow:hidden on body, so pin the body
  // in place at the current scroll offset and put it back on close.
  useEffect(() => {
    if (!src) return;
    const y = window.scrollY;
    const { position, top, width, overflow } = document.body.style;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${y}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    document.body.classList.add('lightbox-open');
    const onKey = (e) => e.key === 'Escape' && onCloseRef.current?.();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.position = position;
      document.body.style.top = top;
      document.body.style.width = width;
      document.body.style.overflow = overflow;
      document.body.classList.remove('lightbox-open');
      window.removeEventListener('keydown', onKey);
      window.scrollTo(0, y);
    };
  }, [src]);

  // A new photo starts unzoomed.
  const [shownSrc, setShownSrc] = useState(src);
  if (src !== shownSrc) {
    setShownSrc(src);
    setView({ s: 1, x: 0, y: 0, settling: false });
  }

  if (!src) return null;

  // How far the photo may move at scale s: half of how much it overflows the
  // screen on each axis (0 when it fits).
  const limits = (s) => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage) return { mx: 0, my: 0, w: 1, h: 1 };
    const w = img.offsetWidth || 1;
    const h = img.offsetHeight || 1;
    return { mx: Math.max(0, (w * s - stage.clientWidth) / 2), my: Math.max(0, (h * s - stage.clientHeight) / 2), w: stage.clientWidth, h: stage.clientHeight };
  };
  const center = () => {
    const r = stageRef.current?.getBoundingClientRect();
    return r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2 } : { cx: 0, cy: 0 };
  };
  // Back inside the bounds (and to 1x if pinched below it), animated.
  const settle = (v = viewRef.current) => {
    const s = clamp(v.s, 1, MAX_ZOOM);
    const { mx, my } = limits(s);
    setView({ s, x: s === 1 ? 0 : clamp(v.x, -mx, mx), y: s === 1 ? 0 : clamp(v.y, -my, my), settling: true });
  };
  // Zoom to `s` keeping the screen point (px, py) still.
  const zoomAround = (s, px, py, from = viewRef.current) => {
    const { cx, cy } = center();
    const k = s / from.s;
    return { s, x: px - cx - (px - cx - from.x) * k, y: py - cy - (py - cy - from.y) * k };
  };

  const onPointerDown = (e) => {
    const g = gesture.current;
    // No pointer capture: the stage already fills the screen, and capture
    // would retarget a tap on the photo to the stage (which closes it).
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    g.moved = false;
    const pts = [...g.pointers.values()];
    const v = viewRef.current;
    if (pts.length === 2) {
      const [a, b] = pts;
      g.start = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, view: v };
    } else {
      g.start = { kind: 'pan', px: e.clientX, py: e.clientY, view: v };
    }
    if (v.settling) setView({ ...v, settling: false });
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId) || !g.start) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...g.pointers.values()];
    const st = g.start;
    if (st.kind === 'pinch' && pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      // Softly resists past 1x and MAX_ZOOM instead of stopping dead.
      const raw = st.view.s * (dist / st.dist);
      const s = raw < 1 ? 1 - band(1 - raw, 1) : raw > MAX_ZOOM ? MAX_ZOOM + band(raw - MAX_ZOOM, MAX_ZOOM) : raw;
      const z = zoomAround(s, st.mx, st.my, st.view);
      g.moved = true;
      setView({ s, x: z.x + (mx - st.mx), y: z.y + (my - st.my), settling: false });
      return;
    }
    if (st.kind === 'pan' && pts.length === 1) {
      const dx = e.clientX - st.px;
      const dy = e.clientY - st.py;
      if (!g.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
      g.moved = true;
      // Unzoomed, a drag does nothing: the photo already fits.
      if (st.view.s <= 1) return;
      const { mx, my, w, h } = limits(st.view.s);
      setView({ s: st.view.s, x: rubber(st.view.x + dx, -mx, mx, w), y: rubber(st.view.y + dy, -my, my, h), settling: false });
    }
  };

  const onPointerUp = (e) => {
    const g = gesture.current;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size === 1) {
      // One finger left after a pinch: keep panning from here.
      const [p] = [...g.pointers.values()];
      g.start = { kind: 'pan', px: p.x, py: p.y, view: viewRef.current };
      return;
    }
    if (g.pointers.size) return;
    const wasGesture = g.moved;
    g.start = null;
    if (wasGesture) {
      settle();
      return;
    }
    // A tap: a second one soon after zooms in there, or back out.
    const now = Date.now();
    if (now - g.lastTap < DOUBLE_TAP_MS) {
      g.lastTap = 0;
      const v = viewRef.current;
      if (v.s > 1.01) setView({ s: 1, x: 0, y: 0, settling: true });
      else {
        const z = zoomAround(DOUBLE_TAP_ZOOM, e.clientX, e.clientY, v);
        const { mx, my } = limits(DOUBLE_TAP_ZOOM);
        setView({ s: DOUBLE_TAP_ZOOM, x: clamp(z.x, -mx, mx), y: clamp(z.y, -my, my), settling: true });
      }
      return;
    }
    g.lastTap = now;
  };

  // A tap beside the photo closes it, but never the end of a pinch or drag,
  // and never while zoomed in (that tap was most likely meant for the photo).
  const onStageClick = (e) => {
    if (e.target !== e.currentTarget || gesture.current.moved || viewRef.current.s > 1.01) return;
    onClose?.();
  };

  const zoomed = view.s > 1.01;
  return createPortal(
    <div className={`lightbox ${zoomed ? 'is-zoomed' : ''}`} role="dialog" aria-modal="true" aria-label={alt}>
      <div
        ref={stageRef}
        className="lightbox-stage"
        onClick={onStageClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onTouchMove={(e) => e.preventDefault()}
      >
        {failedSrc === src ? (
          <p className="lightbox-error" role="alert">
            {'\u{1F4F7}'} This photo couldn't load. Check your connection and try again.
          </p>
        ) : (
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            draggable={false}
            referrerPolicy="no-referrer"
            className={view.settling ? 'is-settling' : ''}
            style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})` }}
            onError={() => setFailedSrc(src)}
            onTransitionEnd={() => viewRef.current.settling && setView((v) => ({ ...v, settling: false }))}
          />
        )}
      </div>
      {credit && <PlacePhotoCredit photo={credit} className="lightbox-credit" />}
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
        {'\u{2715}'}
      </button>
    </div>,
    document.body
  );
}
