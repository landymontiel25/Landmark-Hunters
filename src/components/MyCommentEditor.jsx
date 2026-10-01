import { useState } from 'react';
import { saveMyComment } from '../lib/reviews';
import { COMMENT_MAX, TIERS } from '../lib/ratingFlow';
import { friendlyError } from '../lib/friendlyError';

// Your own comment on a place: shows it, and lets you add one or edit it any
// time later. Used on the landmark page's Comments section and on each row of
// My Check-ins. A comment is only ever saved together with a rating tier
// (I loved it / Ok / I didn't like it): with a tier on file `tier` is passed
// and only the text changes; without one (an old comment-only review, or
// none yet) the editor asks you to pick one first.
export default function MyCommentEditor({ userId, userName, landmark, comment, tier = null, onSaved, compact = false }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [pickedTier, setPickedTier] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // What you just saved shows right away, before the parent reloads.
  const [savedText, setSavedText] = useState(null);
  const shown = savedText ?? comment ?? '';

  const start = () => {
    setText(shown || '');
    setPickedTier(null);
    setError(null);
    setEditing(true);
  };

  const needsTier = !tier;
  const save = async () => {
    if (needsTier && !pickedTier) {
      setError("Pick how it was first: I loved it, Ok, or I didn't like it.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveMyComment({ userId, userName, landmark, comment: text, tier: tier || pickedTier });
      setSavedText(saved);
      setEditing(false);
      onSaved?.(saved);
    } catch (e) {
      setError(friendlyError(e, "Couldn't save your comment. It's still here -- try again."));
    } finally {
      setSaving(false);
    }
  };

  const stop = (e) => e.stopPropagation();

  if (!editing) {
    return (
      <div className={`my-comment ${compact ? 'my-comment-compact' : ''}`} onClick={stop} onKeyDown={stop}>
        {shown ? <p className="review-comment" style={{ margin: 0 }}>{shown}</p> : null}
        <button type="button" className="btn btn-ghost btn-tight" onClick={start}>
          {shown ? `${'\u{270F}\u{FE0F}'} Edit comment` : `${'\u{1F4AC}'} Add a comment`}
        </button>
      </div>
    );
  }

  return (
    <div className={`my-comment ${compact ? 'my-comment-compact' : ''}`} onClick={stop} onKeyDown={stop}>
      {needsTier && (
        <div className="rating-tier-grid" role="group" aria-label="How was it?" style={{ marginBottom: 8 }}>
          {TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chip rating-tier ${pickedTier === t.id ? 'selected' : ''}`}
              aria-pressed={pickedTier === t.id}
              onClick={() => setPickedTier(t.id)}
            >
              <span className="chip-icon">{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        className="rating-comment"
        name="my-comment"
        aria-label={`Your comment on ${landmark.name}`}
        autoCapitalize="sentences"
        rows={3}
        maxLength={COMMENT_MAX}
        placeholder="What was it like? Anything worth knowing?"
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving || (needsTier && !pickedTier)} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="tag tag-error" style={{ display: 'block', marginTop: 6 }}>
          {error}
        </p>
      )}
    </div>
  );
}
