import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { saveLandmarkEdit, clearLandmarkEdit } from '../lib/landmarkOverrides';
import CategorySelect from './CategorySelect';

// Admin Mode's edit tool for a BUILT-IN (static catalog) landmark. There's
// no Firestore doc for the landmark itself to update -- src/data/landmarks.*.js
// is still the base record -- so Save writes a patch to the landmark_edits
// collection instead, which every screen merges on top of the static data
// at render time (see LandmarkEditsContext). Live for everyone immediately,
// same as editing a custom landmark; "Reset to Original" deletes the patch
// and reverts to whatever's in the source file.
export default function AdminEditBuiltInPanel({ landmark, onSaved }) {
  const { user } = useAuth();
  const [name, setName] = useState(landmark.name || '');
  const [category, setCategory] = useState(landmark.categories?.[0] || '');
  const [summary, setSummary] = useState(landmark.summary || '');
  const [facts, setFacts] = useState((landmark.facts || []).join('\n'));
  const [free, setFree] = useState(landmark.free !== false);
  const [typicalMinutes, setTypicalMinutes] = useState(String(landmark.typicalMinutes ?? 15));
  const [imageUrl, setImageUrl] = useState(landmark.images?.[0] || '');
  const [saving, setSaving] = useState(false);
  // Catalog landmarks store their city as `region`; list/map copies add `regionId`.
  const regionId = landmark.regionId ?? landmark.region;
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState(null);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const minutes = Math.round(Number(typicalMinutes));
      await saveLandmarkEdit({
        region: regionId,
        id: landmark.id,
        userId: user?.uid,
        fields: {
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
          // Only the first photo is editable here -- keep the rest of the gallery.
          images: [imageUrl.trim(), ...(landmark.images || []).slice(1)].filter(Boolean),
        },
      });
      onSaved?.();
      setMsg({ ok: true, text: 'Saved — live for everyone now.' });
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Could not save — try again.' });
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm(`Revert "${landmark.name}" to its original catalog data?`)) return;
    setResetting(true);
    setMsg(null);
    try {
      await clearLandmarkEdit(regionId, landmark.id);
      onSaved?.();
      setMsg({ ok: true, text: 'Reverted to the original catalog data.' });
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Could not revert — try again.' });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="card section" style={{ borderColor: 'var(--color-rust)' }}>
      <h3 style={{ marginTop: 0 }}>{'\u{1F6E0}\u{FE0F}'} Admin Mode — Edit Built-In Landmark</h3>
      <p className="screen-subtitle" style={{ marginTop: -6 }}>
        This is catalog data, not a submission — Save patches it live for everyone; the original stays in the app's
        source code and "Reset to Original" reverts to it.
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
        <input type="text" placeholder="https://…" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
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

      <button type="button" className="btn btn-primary btn-block" disabled={saving || resetting} onClick={save}>
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
        style={{ marginTop: 16 }}
        disabled={saving || resetting}
        onClick={reset}
      >
        {resetting ? 'Reverting…' : `${'\u{21BA}'} Reset to Original`}
      </button>
    </div>
  );
}
