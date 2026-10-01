// "Reload once" guard for a screen file that is gone after a deploy.
//
// The flag lives in sessionStorage, but that can throw (blocked storage, some
// private windows). Without a fallback the flag could never be set, so a
// screen file that is really missing would reload the page forever. The
// fallback is window.name, which survives a reload of the same tab.
const RELOAD_FLAG = 'lh-chunk-reload';
const NAME_MARK = '|lh-chunk-reload';

const nameHas = () => typeof window !== 'undefined' && String(window.name || '').includes(NAME_MARK);

export function flagGet() {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return '1';
  } catch {
    /* blocked storage */
  }
  return nameHas() ? '1' : null;
}

export function flagSet() {
  try {
    sessionStorage.setItem(RELOAD_FLAG, '1');
  } catch {
    /* blocked storage */
  }
  if (typeof window !== 'undefined' && !nameHas()) window.name = String(window.name || '') + NAME_MARK;
}

export function flagClear() {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    /* blocked storage */
  }
  if (nameHas()) window.name = String(window.name).split(NAME_MARK).join('');
}

// Offline, a reload only swaps the app for the browser's own "no internet"
// page; the screen's error card (with its Try Again) is the better place to
// land. Otherwise reload at most once.
export function shouldReloadForChunkError() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return !flagGet();
}
