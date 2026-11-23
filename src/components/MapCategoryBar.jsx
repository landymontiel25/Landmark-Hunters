import { useEffect, useRef } from 'react';
import { PICKABLE_INTERESTS } from '../data/regions';
import { SHORT_CATEGORY } from '../data/categoryLabels';
import { springEasing, supportsLinearEasing } from '../lib/spring';

// Select All's one-time zoom (owner, 2026-11-22): when the Map opens with
// no landmarks showing, the button grows really big, holds a beat, then
// springs back to its size; the pulse carries on until it's tapped. It
// plays on every Map open until Select All has been used once, then never
// again. A copy of the button does the zoom over everything (the bar
// scrolls and would clip the real one); taps go through to the real button.
const USED_KEY = 'lh.selectAllUsed';
export function selectAllUsed() {
  try {
    return localStorage.getItem(USED_KEY) === '1';
  } catch {
    return false;
  }
}
function markSelectAllUsed() {
  try {
    localStorage.setItem(USED_KEY, '1');
  } catch {
    /* private mode: it just plays again next time */
  }
}
const ZOOM_DELAY_MS = 500; // let the Map and sheet settle first
const ZOOM_HOLD_MS = 450;
const GROW = { damping: 1, response: 0.35 };
const SETTLE = { damping: 0.6, response: 0.5 }; // the spring back, with a little bounce
const SPRING_FALLBACK = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

// The zoom's size and shift for a button at `r` (DOMRect): about 70% of the
// screen wide, at most 3x, and kept 16 px inside the screen.
export function zoomTarget(r, vw, vh) {
  const scale = Math.max(1.6, Math.min(3, (vw * 0.7) / r.width));
  const w = r.width * scale;
  const h = r.height * scale;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const clamp = (c, half, size) => Math.min(Math.max(c, 16 + half), size - 16 - half);
  return { scale, dx: clamp(cx, w / 2, vw) - cx, dy: clamp(cy, h / 2, vh) - cy };
}

function useSelectAllZoom(btnRef, needsPick) {
  // Only when the Map opens with nothing showing, never on a later change.
  const openedEmpty = useRef(needsPick);
  useEffect(() => {
    if (!openedEmpty.current || !needsPick || selectAllUsed()) return undefined;
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    let clone = null;
    let anim = null;
    let stopped = false;
    const stop = () => {
      stopped = true;
      anim?.cancel();
      clone?.remove();
    };
    const timer = setTimeout(async () => {
      const btn = btnRef.current;
      if (!btn?.animate) return;
      const r = btn.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > window.innerHeight) return;
      openedEmpty.current = false; // once per Map open
      clone = btn.cloneNode(true);
      clone.removeAttribute('aria-pressed');
      clone.setAttribute('aria-hidden', 'true');
      clone.tabIndex = -1;
      clone.classList.add('map-cat-all-zoom');
      Object.assign(clone.style, {
        position: 'fixed',
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        margin: '0',
        zIndex: '5000',
        pointerEvents: 'none',
        transformOrigin: 'center',
      });
      document.body.appendChild(clone);
      const { scale, dx, dy } = zoomTarget(r, window.innerWidth, window.innerHeight);
      const big = `translate(${dx}px, ${dy}px) scale(${scale})`;
      const linear = supportsLinearEasing();
      const grow = springEasing(GROW);
      const settle = springEasing(SETTLE);
      try {
        anim = clone.animate([{ transform: 'none' }, { transform: big }], { duration: grow.ms, easing: linear ? grow.easing : 'ease-out', fill: 'forwards' });
        await anim.finished;
        if (stopped) return;
        await new Promise((res) => setTimeout(res, ZOOM_HOLD_MS));
        if (stopped) return;
        anim = clone.animate([{ transform: big }, { transform: 'none' }], { duration: linear ? settle.ms : 600, easing: linear ? settle.easing : SPRING_FALLBACK, fill: 'forwards' });
        await anim.finished;
      } catch {
        /* cancelled: Select All was tapped mid-zoom */
      }
      clone?.remove();
      clone = null;
    }, ZOOM_DELAY_MS);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [btnRef, needsPick]);
}

// The Map's category bar (owner, 2026-11-07): the Map opens with nothing
// chosen and no pins; you pick "Select All" or one or more category emojis
// at the top. Signed in, it sits in the picks sheet above "Discover popular
// landmarks" (className map-cat-bar-sheet; owner, 2026-11-08), else over
// the map. `value` is null (nothing yet), 'all', or a list of category
// ids. MapExplore keeps it in session state, so it holds while you switch
// tabs and resets when the app is closed.
export default function MapCategoryBar({ value, onChange, className = '' }) {
  const all = value === 'all';
  const picked = Array.isArray(value) ? value : [];
  const toggle = (id) => {
    // From Select All, an emoji narrows to just that category.
    if (all) return onChange([id]);
    const next = picked.includes(id) ? picked.filter((c) => c !== id) : [...picked, id];
    onChange(next.length ? next : null);
  };
  const needsPick = value == null;
  const allRef = useRef(null);
  useSelectAllZoom(allRef, needsPick);
  const inSheet = className.includes('map-cat-bar-sheet');
  return (
    <>
    {inSheet && (
      <p className={`map-cat-prompt ${needsPick ? 'needs-pick' : ''}`} role={needsPick ? 'status' : undefined}>
        {needsPick ? 'Choose Select All or a category to see places on the map' : 'Swipe up for picks near you'}
      </p>
    )}
    <div className={`map-cat-bar ${className} ${needsPick ? 'needs-pick' : ''}`.trim()} role="group" aria-label="Show on the map">
      <button
        ref={allRef}
        type="button"
        className={`map-cat-chip map-cat-all ${all ? 'on' : ''}`}
        aria-pressed={all}
        onClick={() => {
          if (!all) markSelectAllUsed();
          onChange(all ? null : 'all');
        }}
      >
        Select All
      </button>
      {PICKABLE_INTERESTS.map((i) => {
        const on = all || picked.includes(i.id);
        return (
          <button
            key={i.id}
            type="button"
            className={`map-cat-chip ${on ? 'on' : ''}`}
            aria-pressed={on}
            aria-label={i.label}
            title={i.label}
            onClick={() => toggle(i.id)}
          >
            <span aria-hidden="true">{i.icon}</span>
            {/* Every icon has its name beside it (owner, 2026-11-14). */}
            <span className="map-cat-name" aria-hidden="true">
              {SHORT_CATEGORY[i.id] || i.label}
            </span>
          </button>
        );
      })}
    </div>
    </>
  );
}

// Whether a landmark shows for the bar's value.
export function passesMapCategories(value, landmark) {
  if (value === 'all') return true;
  if (!Array.isArray(value) || !value.length) return false;
  return (landmark.categories || []).some((c) => value.includes(c));
}
