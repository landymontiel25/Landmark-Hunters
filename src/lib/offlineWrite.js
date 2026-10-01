// Firestore write promises (setDoc / updateDoc / deleteDoc / addDoc /
// batch.commit) resolve only once the SERVER acknowledges the write. Offline
// they never settle: the write sits in the local queue and flushes on
// reconnect, but any handler that `await`s it leaves its spinner running
// forever (a driver in a tunnel taps "Add friend" and nothing ever happens).
//
// settleWrite() bounds that wait. If the write hasn't settled after `ms` AND
// the device is offline, it resolves with { queued: true } so the UI can move
// on, and it announces "Saved on this device" (window event -> ToastProvider).
// If the queued write is later rejected (security rules, say) it announces
// that too, instead of the user silently losing it. Online, it simply waits
// for the real result, so a rejection still throws to the caller as before.

export const WRITE_QUEUED_EVENT = 'lh:write-queued';
export const WRITE_REJECTED_EVENT = 'lh:write-rejected';
export const OFFLINE_WRITE_WAIT_MS = 4000;
export const QUEUED_MESSAGE = "Saved on this device. It will sync when you're back online.";
export const REJECTED_MESSAGE = "A change you made while offline couldn't be saved.";

function offline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function announce(name, detail) {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    /* no window (SSR/tests) */
  }
}

export function settleWrite(promise, { ms = OFFLINE_WRITE_WAIT_MS, label = '' } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    let queued = false;
    let timer;
    // Re-arms while online: a connection that drops mid-wait is still caught.
    const check = () => {
      if (done) return;
      if (!offline()) {
        timer = setTimeout(check, ms);
        return;
      }
      queued = true;
      done = true;
      announce(WRITE_QUEUED_EVENT, { label });
      resolve({ queued: true });
    };
    timer = setTimeout(check, ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        if (!done) {
          done = true;
          resolve(v);
        }
      },
      (e) => {
        clearTimeout(timer);
        if (!done) {
          done = true;
          reject(e);
        } else if (queued) {
          announce(WRITE_REJECTED_EVENT, { label, error: e });
        }
      }
    );
  });
}
