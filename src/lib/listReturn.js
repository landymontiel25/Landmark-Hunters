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
