import { useState } from 'react';

// ✏️ next to an itinerary's title; tapping it swaps the title for a text box.
export default function EditableTitle({ value, onSave, prefix = null, label = 'Rename itinerary' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <h1 className="screen-title editable-title">
        {prefix}
        <span>{value}</span>
        <button
          type="button"
          className="rename-btn"
          aria-label={label}
          title={label}
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          {'\u{270F}\u{FE0F}'}
        </button>
      </h1>
    );
  }

  const save = (e) => {
    e?.preventDefault();
    const clean = draft.trim();
    if (clean && clean !== value) onSave(clean);
    setEditing(false);
  };

  return (
    <form className="rename-form" onSubmit={save}>
      <input
        type="text"
        name="itinerary-name"
        aria-label={label}
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="done"
        maxLength={80}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          // Cancel the rename only; don't also close the dialog around it.
          e.preventDefault();
          setEditing(false);
        }}
      />
      <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()}>
        Save
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
        Cancel
      </button>
    </form>
  );
}
