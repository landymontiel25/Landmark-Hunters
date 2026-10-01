import { useEffect, useRef, useState } from 'react';

// useState that survives closing the app. Drafts, half-filled forms,
// filters and searches are saved to this device (localStorage) as you type
// and restored when you come back. Storage can be unavailable (private
// mode, quota, blocked site data): every access is guarded, and the hook
// then behaves exactly like plain useState.
//
// key: include the user's uid for anything personal, so a shared device
// never shows one account's draft to another.
// ttlMs: drafts older than this are dropped instead of restored.

const PREFIX = 'lh.draft.v1.';

function read(key, ttlMs) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const { v, t } = JSON.parse(raw);
    if (ttlMs && Date.now() - t > ttlMs) {
      localStorage.removeItem(PREFIX + key);
      return undefined;
    }
    return v;
  } catch {
    return undefined;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ v: value, t: Date.now() }));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
}

export function clearPersisted(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export function readPersisted(key, ttlMs) {
  return read(key, ttlMs);
}

export function writePersisted(key, value) {
  write(key, value);
}

// A draft whose submit is still in flight (slow network). The stored copy is
// kept until the submit succeeds -- so a failure never loses it -- but screens
// that mount meanwhile must not present it as an "unsaved draft restored".
const submitting = new Set();
export function markDraftSubmitting(key) {
  if (key) submitting.add(key);
}
export function unmarkDraftSubmitting(key) {
  submitting.delete(key);
}
export function isDraftSubmitting(key) {
  return !!key && submitting.has(key);
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

export function usePersistentState(key, initial, { ttlMs = WEEK, isEmpty } = {}) {
  const [value, setValue] = useState(() => {
    if (!key) return typeof initial === 'function' ? initial() : initial;
    const saved = read(key, ttlMs);
    return saved !== undefined ? saved : typeof initial === 'function' ? initial() : initial;
  });

  // Re-load when the key changes (e.g. a different account signs in).
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    const saved = key ? read(key, ttlMs) : undefined;
    setValue(saved !== undefined ? saved : typeof initial === 'function' ? initial() : initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Debounced save; an empty value clears the stored copy so a finished or
  // abandoned form doesn't come back.
  useEffect(() => {
    if (!key) return undefined;
    const t = setTimeout(() => {
      const empty = isEmpty ? isEmpty(value) : value === '' || value == null;
      if (empty) clearPersisted(key);
      else write(key, value);
    }, 250);
    return () => clearTimeout(t);
  }, [key, value, isEmpty]);

  return [value, setValue, () => (key ? clearPersisted(key) : undefined)];
}

// For settings that should last while the app is open (hopping between
// tabs) but start fresh every launch, like category filters. Held in
// memory only, so closing or reloading the app resets it.
const sessionValues = new Map();

export function useSessionState(key, initial) {
  const [value, setValue] = useState(() => (sessionValues.has(key) ? sessionValues.get(key) : initial));
  useEffect(() => {
    sessionValues.set(key, value);
  }, [key, value]);
  return [value, setValue];
}
