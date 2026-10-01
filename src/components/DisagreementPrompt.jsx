import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DISAGREEMENT_OPTIONS } from '../lib/rerating';
import { COMMENT_MAX } from '../lib/ratingFlow';

// "Your answer changed a lot. What happened?" -- asked once when the user's
// own answers on a place are two levels apart (docs/rerating.md). One tap on a
// reason answers (whatever is in the note box goes with it); Skip answers too.
// Escape counts as Skip. Reuses the app's modal-backdrop / modal-card, whose
// padding already keeps clear of the safe-area insets, and is portaled above
// whatever dialog opened it.
export default function DisagreementPrompt({ landmarkName, onAnswer }) {
  const [note, setNote] = useState('');
  const first = useRef(null);
  const noteRef = useRef('');
  noteRef.current = note;

  useEffect(() => {
    first.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onAnswer({ reason: 'skip', comment: noteRef.current });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="modal-backdrop" style={{ zIndex: 3100 }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="disagree-title" aria-describedby="disagree-sub">
        <h3 id="disagree-title" style={{ marginTop: 0 }}>
          Your answer changed a lot. What happened?
        </h3>
        <p id="disagree-sub" className="screen-subtitle" style={{ marginTop: 0 }}>
          {landmarkName ? `About ${landmarkName}. ` : ''}Tap one so Mapr learns the right thing.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DISAGREEMENT_OPTIONS.map((o, i) => (
            <button
              key={o.reason}
              ref={i === 0 ? first : null}
              type="button"
              className="btn btn-ghost btn-block"
              style={{ minHeight: 44, justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }}
              onClick={() => onAnswer({ reason: o.reason, comment: note })}
            >
              {o.label}
            </button>
          ))}
        </div>
        <textarea
          name="disagreement-note"
          aria-label="Anything to add? (optional)"
          autoComplete="off"
          className="rating-comment"
          rows={2}
          maxLength={COMMENT_MAX}
          placeholder="Anything to add? (optional)"
          style={{ marginTop: 12 }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-ghost btn-block"
          style={{ marginTop: 8, minHeight: 44 }}
          onClick={() => onAnswer({ reason: 'skip', comment: note })}
        >
          Skip
        </button>
      </div>
    </div>,
    document.body
  );
}
