// Remembers where a long list was when you tapped into a place, so Back lands
// on the same rows instead of the top. sessionStorage, not React state: the
// list screen unmounts when you leave it. Read once, then cleared, so a later
// fresh visit never jumps to a stale position.
const key = (name) => `list-return:${name}`;

export function saveListReturn(name, state) {
  try {
    sessionStorage.setItem(key(name), JSON.stringify(state));
  } catch {
    /* blocked storage -- navigation must still work */
  }
}

export function takeListReturn(name) {
  try {
    const raw = sessionStorage.getItem(key(name));
    if (raw == null) return null;
    sessionStorage.removeItem(key(name));
    const state = JSON.parse(raw);
    return state && typeof state === 'object' ? state : null;
  } catch {
    return null;
  }
}

// Scrolls to `y` and keeps at it for up to two seconds, because a page that
// loads in pieces (trip members, addresses, photos) is shorter at first and
// the browser clamps an early scrollTo. Stops as soon as it lands or the
// person scrolls themselves. Returns a cancel function.
export function restoreScroll(y, { intervalMs = 80, maxMs = 2000 } = {}) {
  if (typeof window === 'undefined') return () => {};
  let done = false;
  const started = Date.now();
  const stop = () => {
    done = true;
    window.removeEventListener('wheel', stop);
    window.removeEventListener('touchstart', stop);
    window.removeEventListener('keydown', stop);
    clearTimeout(timer);
  };
  let timer = 0;
  const step = () => {
    if (done) return;
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) <= 2 || Date.now() - started > maxMs) {
      stop();
      return;
    }
    timer = setTimeout(step, intervalMs);
  };
  window.addEventListener('wheel', stop, { passive: true });
  window.addEventListener('touchstart', stop, { passive: true });
  window.addEventListener('keydown', stop);
  requestAnimationFrame(step);
  return stop;
}
