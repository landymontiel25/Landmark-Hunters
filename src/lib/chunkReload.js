// "Reload once" guard for a screen file that is gone after a deploy.
//
// The flag lives in sessionStorage, but that can throw (blocked storage, some
// private windows). Without a fallback the flag could never be set, so a
// screen file that is really missing would reload the page forever. The
// fallback is window.name, which survives a reload of the same tab.
//
// The flag holds the reload's time and only counts for RELOAD_WINDOW_MS: long
// enough to stop a loop, short enough that a later deploy in the same tab
// gets its own reload instead of "Something went wrong".
const RELOAD_FLAG = 'lh-chunk-reload';
const NAME_MARK = '|lh-chunk-reload';
export const RELOAD_WINDOW_MS = 30_000;

const nameStamp = () => {
  if (typeof window === 'undefined') return null;
  const m = String(window.name || '').match(/\|lh-chunk-reload:?(\d*)/);
  return m ? Number(m[1]) || 0 : null;
};
const stripName = () => String(window.name || '').replace(/\|lh-chunk-reload:?\d*/g, '');

export function flagGet(now = Date.now()) {
  let at = null;
  try {
    const v = sessionStorage.getItem(RELOAD_FLAG);
    if (v) at = Number(v) || 0;
  } catch {
    /* blocked storage */
  }
  if (at == null) at = nameStamp();
  return at != null && now - at < RELOAD_WINDOW_MS ? '1' : null;
}

export function flagSet(now = Date.now()) {
  try {
    sessionStorage.setItem(RELOAD_FLAG, String(now));
  } catch {
    /* blocked storage */
  }
  if (typeof window !== 'undefined') window.name = `${stripName()}${NAME_MARK}:${now}`;
}

export function flagClear() {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    /* blocked storage */
  }
  if (typeof window !== 'undefined' && nameStamp() != null) window.name = stripName();
}

// Offline, a reload only swaps the app for the browser's own "no internet"
// page; the screen's error card (with its Try Again) is the better place to
// land. Otherwise reload at most once.
export function shouldReloadForChunkError(now = Date.now()) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return !flagGet(now);
}

// What a lazy screen's import resolved to. Vite's preload helper resolves
// to undefined instead of rejecting when the vite:preloadError listener
// (App.jsx) cancels the error to reload the page. Rendering that crashed
// the screen ("Cannot read properties of undefined (reading 'default')")
// for the moment before the reload, and clearing the flag here let the next
// load reload again (a loop when the file is really gone). Wait for the
// reload instead, with the flag still set.
export function settleScreenModule(m) {
  if (m == null) return new Promise(() => {});
  flagClear();
  return m;
}
