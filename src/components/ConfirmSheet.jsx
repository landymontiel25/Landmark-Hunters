import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// A warning before something you can't quietly take back (Report, Block).
// const { confirm, node } = useConfirm();
// if (!(await confirm({ title, body, confirmLabel }))) return;
// ...and render {node} once in the screen.
export function useConfirm() {
  const [ask, setAsk] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setAsk(opts);
      }),
    []
  );
  const close = (answer) => {
    resolver.current?.(answer);
    resolver.current = null;
    setAsk(null);
  };

  const node = ask ? <ConfirmSheet {...ask} onConfirm={() => close(true)} onCancel={() => close(false)} /> : null;
  return { confirm, node };
}

export default function ConfirmSheet({ title, body, confirmLabel = 'Continue', cancelLabel = 'Cancel', danger = true, onConfirm, onCancel }) {
  return createPortal(
    <div className="modal-backdrop save-sheet-backdrop" onClick={onCancel}>
      <div className="modal-card save-sheet" role="alertdialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>
          {'\u{26A0}\u{FE0F}'} {title}
        </h3>
        {(Array.isArray(body) ? body : [body]).filter(Boolean).map((p, i) => (
          <p key={i} className="screen-subtitle" style={{ marginTop: i ? 8 : 0 }}>
            {p}
          </p>
        ))}
        <div className="save-sheet-actions">
          <button type="button" className="btn btn-ghost btn-sm" autoFocus onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
