// Turns whatever went wrong (a Firebase error code, a failed fetch, an HTTP
// status, a thrown Error) into one short sentence a traveler can act on.
// Never shows raw backend text like "FirebaseError: [code=unavailable]".

import { authErrorMessage } from './authErrors';

const FIREBASE = {
  unavailable: "Can't reach the server right now. Check your connection and try again.",
  'deadline-exceeded': 'That took too long. Try again.',
  'permission-denied': "You don't have permission to do that. Try signing out and back in.",
  unauthenticated: 'Please sign in again to continue.',
  'resource-exhausted': 'Too many requests right now. Wait a moment and try again.',
  'not-found': "We couldn't find that. It may have been removed.",
  'already-exists': 'That already exists.',
  aborted: 'Someone else changed this at the same time. Try again.',
  cancelled: 'That was cancelled. Try again.',
  'storage/retry-limit-exceeded': 'The upload kept failing. Check your connection and try again.',
  'storage/unauthorized': "That photo couldn't be uploaded. Make sure it's an image under 8 MB.",
  'storage/canceled': 'Upload cancelled.',
  'storage/quota-exceeded': "Photo storage is full right now. Try again later.",
};

const HTTP = {
  400: "Something about that request didn't look right. Try again.",
  401: 'Please sign in to continue.',
  403: "You don't have access to that.",
  404: "We couldn't find that.",
  408: 'That took too long. Try again.',
  429: 'Too many requests in a row. Wait a moment and try again.',
  500: 'Something went wrong on our end. Try again in a moment.',
  502: 'Our server is having trouble. Try again in a moment.',
  503: 'This is temporarily unavailable. Try again in a moment.',
  504: 'That took too long. Try again.',
};

export const OFFLINE_MESSAGE = "You're offline. Reconnect and try again — nothing you entered was lost.";

export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Would trying the same thing again have a chance of working? False for our
 * own validation messages ("You already sent @x a request", "You two are
 * already friends"): they are the answer, and a Retry button on them just
 * repeats it. Server (/api) errors carry a `status` and stay retryable.
 */
export function isRetryable(err) {
  return !(err && err.userMessage && err.status == null);
}

/**
 * friendlyError(err, fallback) -> string
 * err may be an Error, a Firebase error ({ code }), a fetch Response-shaped
 * error ({ status }), or an Error thrown with a server `error` message our
 * own /api endpoints already wrote in plain language (err.userMessage).
 */
export function friendlyError(err, fallback = 'Something went wrong. Try again.') {
  if (isOffline()) return OFFLINE_MESSAGE;
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (err.userMessage) return err.userMessage;
  const code = String(err.code || '').replace(/^firestore\//, '');
  if (FIREBASE[code]) return FIREBASE[code];
  // A Firebase Auth failure that surfaced somewhere other than the sign-in
  // form (token refresh before an upload, a re-check of the session...).
  if (code.startsWith('auth/')) return authErrorMessage(err);
  if (err.status && HTTP[err.status]) return HTTP[err.status];
  const msg = String(err.message || '');
  if (err.name === 'TypeError' && /fetch|network|load failed/i.test(msg)) {
    return "Can't reach the server right now. Check your connection and try again.";
  }
  if (/timed out|timeout/i.test(msg)) return 'That took too long. Try again.';
  return fallback;
}

// How long one of our own /api calls may take before the app gives up. The
// server's own limit (vercel.json maxDuration) is 60s; this stays just above
// it so a hung connection ends in a clear message.
const API_TIMEOUT_MS = 65000;

/**
 * POSTs/GETs one of our own /api endpoints and returns parsed JSON, or
 * throws an Error carrying `status` and, when the server sent one, its
 * plain-language `error` text as `userMessage` (our endpoints write those
 * for people, not developers). A reply that isn't JSON (an HTML 404/504
 * page from the host) never leaks its parse error: it becomes a plain
 * status-based message. A call that hangs ends as a "took too long" error.
 */
export async function fetchJson(url, options, { timeoutMs = API_TIMEOUT_MS } = {}) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  let data = null;
  try {
    res = await fetch(url, ctrl ? { ...options, signal: ctrl.signal } : options);
    data = await res.json().catch(() => null);
  } catch (e) {
    const timedOut = ctrl?.signal.aborted;
    const err = new Error(timedOut ? 'Request timed out' : e?.message || 'Network error');
    err.name = timedOut ? 'TimeoutError' : 'TypeError';
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok || !data) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    if (data?.error && typeof data.error === 'string') err.userMessage = data.error;
    // A missing /api route (or a host error page) isn't "that thing was
    // removed" -- the service itself isn't reachable.
    else if (res.status === 404) err.userMessage = "That feature isn't available right now. Try again in a moment.";
    else if (res.ok) err.userMessage = 'We got an unexpected reply from the server. Try again in a moment.';
    if (data?.code) err.code = data.code;
    throw err;
  }
  return data;
}
