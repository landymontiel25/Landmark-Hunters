import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { updateCustomLandmark, deleteCustomLandmark } from '../lib/customLandmarks';
import CategorySelect from './CategorySelect';

// Admin Mode's edit tool for a user-submitted landmark -- shown on its own
// page (LandmarkDetail) when Settings -> Admin Mode is on. Every field here
// writes straight to Firestore the moment Save is tapped: no draft, no
// review step, live for everyone immediately, exactly like the rest of the
// app's admin actions. Only reachable for a custom (Firestore-backed)
// landmark -- the built-in catalog is static source data checked into the
// repo, so correcting one of those still goes through a normal code change
// instead of a live in-app edit.
export default function AdminEditLandmarkPanel({ landmark, onSaved, onDeleted }) {
  const navigate = useNavigate();
  const [name, setName] = useState(landmark.name || '');
  const [category, setCategory] = useState(landmark.categories?.[0] || '');
  const [summary, setSummary] = useState(landmark.summary || '');
  const [facts, setFacts] = useState((landmark.facts || []).join('\n'));
  const [free, setFree] = useState(landmark.free !== false);
  const [typicalMinutes, setTypicalMinutes] = useState(String(landmark.typicalMinutes ?? 15));
  const [imageUrl, setImageUrl] = useState(landmark.images?.[0] || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const minutes = Math.round(Number(typicalMinutes));
      const fields = {
        name: name.trim() || landmark.name,
        categories: category ? [category] : [],
        summary: summary.trim(),
        facts: facts
          .split('\n')
          .map((f) => f.trim())
          .filter(Boolean)
          .slice(0, 5),
        free,
        typicalMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 15,
        images: imageUrl.trim() ? [imageUrl.trim()] : [],
      };
      await updateCustomLandmark(landmark.docId, fields);
      onSaved?.(fields);
      setMsg({ ok: true, text: 'Saved — live for everyone now.' });
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Could not save — try again.' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${landmark.name}" for everyone? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await deleteCustomLandmark(landmark.docId);
      onDeleted?.();
      navigate('/');
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Could not delete — try again.' });
      setDeleting(false);
    }
  };

  return (
    <div className="card section" style={{ borderColor: 'var(--color-rust)' }}>
      <h3 style={{ marginTop: 0 }}>{'\u{1F6E0}\u{FE0F}'} Admin Mode — Edit Landmark</h3>
      <p className="screen-subtitle" style={{ marginTop: -6 }}>
        Changes here are live for everyone the moment you tap Save.
      </p>

      <div className="field">
        <label>Name</label>
        <input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="field">
        <label>Category</label>
        <CategorySelect value={category} onSelect={setCategory} />
      </div>

      <div className="field">
        <label>Summary</label>
        <textarea
          className="rating-comment"
          style={{ width: '100%', minHeight: 60 }}
          value={summary}
          maxLength={300}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>

      <div className="field">
        <label>Facts (one per line, up to 5)</label>
        <textarea
          className="rating-comment"
          style={{ width: '100%', minHeight: 100 }}
          value={facts}
          onChange={(e) => setFacts(e.target.value)}
        />
      </div>

      <div className="field">
        <label>Photo URL</label>
        <input
          type="text"
          placeholder="https://…"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
          Free to visit
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
          Typical visit (min)
          <input
            type="number"
            min={1}
            style={{ width: 70 }}
            value={typicalMinutes}
            onChange={(e) => setTypicalMinutes(e.target.value)}
          />
        </label>
      </div>

      <button type="button" className="btn btn-primary btn-block" disabled={saving || deleting} onClick={save}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
      {msg && (
        <p className={`tag ${msg.ok ? 'tag-free' : 'tag-error'}`} style={{ display: 'block', marginTop: 10 }}>
          {msg.text}
        </p>
      )}

      <button
        type="button"
        className="btn btn-ghost btn-block"
        style={{ marginTop: 16, color: 'var(--color-error, #b3503f)' }}
        disabled={saving || deleting}
        onClick={remove}
      >
        {deleting ? 'Deleting…' : `${'\u{1F5D1}'} Delete This Landmark`}
      </button>
    </div>
  );
}
