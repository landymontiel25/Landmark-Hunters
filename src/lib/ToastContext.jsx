import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { WRITE_QUEUED_EVENT, WRITE_REJECTED_EVENT, QUEUED_MESSAGE, REJECTED_MESSAGE } from './offlineWrite';

// Small, bottom-of-screen messages for things that happened off-screen --
// mostly "that didn't save, we put it back" after an optimistic update had
// to be undone. Optional action button (e.g. Retry).
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (message, { actionLabel, onAction, tone = 'error', durationMs = 6000 } = {}) => {
      const id = ++idRef.current;
      setToasts((all) => [...all.slice(-2), { id, message, actionLabel, onAction, tone }]);
      if (durationMs) setTimeout(() => dismiss(id), durationMs);
      return id;
    },
    [dismiss]
  );

  // Writes made offline are queued by Firestore: say so when they are, and say
  // so if one is rejected after reconnecting (see offlineWrite.js).
  useEffect(() => {
    const queued = () => show(QUEUED_MESSAGE, { tone: 'info' });
    const rejected = () => show(REJECTED_MESSAGE, { durationMs: 10000 });
    window.addEventListener(WRITE_QUEUED_EVENT, queued);
    window.addEventListener(WRITE_REJECTED_EVENT, rejected);
    return () => {
      window.removeEventListener(WRITE_QUEUED_EVENT, queued);
      window.removeEventListener(WRITE_REJECTED_EVENT, rejected);
    };
  }, [show]);

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            <span className="toast-text">{t.message}</span>
            {t.actionLabel && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(t.id);
                  t.onAction?.();
                }}
              >
                {t.actionLabel}
              </button>
            )}
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              {'\u{2715}'}
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Falls back to a no-op outside the provider (tests, isolated renders).
export function useToast() {
  return useContext(ToastContext) || { show: () => 0, dismiss: () => {} };
}

/**
 * Optimistic update helper: apply the change to the UI now, run the real
 * request in the background, and undo it (with a toast + Retry) if the
 * request fails.
 *   runOptimistic({ apply, commit, rollback, toast, errorMessage })
 */
export async function runOptimistic({ apply, commit, rollback, toast, errorMessage, retry }) {
  apply?.();
  try {
    return await commit();
  } catch {
    rollback?.();
    toast?.show(errorMessage || "That didn't save, so we put it back.", retry ? { actionLabel: 'Retry', onAction: retry } : {});
    return undefined;
  }
}
