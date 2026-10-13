import { useState } from 'react';
import { pickPhoto } from '../../lib/imageUtils';
import { cleanTipText, TIP_MAX_CHARS, TIP_MAX_TAGS, TIP_MIN_CHARS, TIP_TAGS } from '../../lib/tips';
import { discardTipPhoto, postTip, uploadTipPhoto } from '../../lib/tipsApi';

// "Share a tip for others?" (docs/discovery-network-plan.md, Phase 1): the
// form for one tip on a verified visit. The server (api/post-tip.js) checks
// everything again; this only keeps the person from typing something it
// will refuse. A tip is public: the screen says so before Post.
export default function TipComposer({ uid, checkinId, landmarkName, onPosted, onCancel }) {
  const [text, setText] = useState('');
  const [tags, setTags] = useState([]);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const length = cleanTipText(text).length;
  const ok = length >= TIP_MIN_CHARS && length <= TIP_MAX_CHARS;

  const toggleTag = (id) => setTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : t.length < TIP_MAX_TAGS ? [...t, id] : t));
  const addPhoto = async () => {
    try {
      const f = await pickPhoto();
      if (!f) return;
      if (preview) URL.revokeObjectURL(preview);
      setFile(f);
      setPreview(URL.createObjectURL(f));
    } catch {
      setMsg("Couldn't use that photo. Try another one.");
    }
  };
  const removePhoto = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
  };

  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setMsg(null);
    let photoURL = null;
    try {
      if (file) photoURL = await uploadTipPhoto(uid, file);
      const out = await postTip({ checkinId, text, tags, photoURL });
      onPosted?.(out);
    } catch (e) {
      // The photo never made it onto a tip: ask the server to remove it.
      if (photoURL) discardTipPhoto(photoURL).catch(() => {});
      setMsg(e?.userMessage || e?.message || "Couldn't share the tip. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tip-composer">
      <h4 style={{ margin: '0 0 6px' }}>{'\u{1F4A1}'} Share a tip for others?</h4>
      <p className="screen-subtitle" style={{ margin: '0 0 8px', fontSize: '0.8rem' }}>
        Something useful about {landmarkName || 'this place'} for the next person. Tips are public and show your username.
      </p>
      <label htmlFor="tip-text" className="visually-hidden">
        Your tip
      </label>
      <textarea
        id="tip-text"
        className="rating-comment"
        rows={3}
        maxLength={TIP_MAX_CHARS + 40}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Go early: the line wraps the block by noon."
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      <div className="screen-subtitle" style={{ fontSize: '0.75rem', textAlign: 'right', margin: '2px 0 8px' }} aria-live="polite">
        {length}/{TIP_MAX_CHARS}
      </div>
      <div className="chip-grid" role="group" aria-label={`Tags, up to ${TIP_MAX_TAGS}`} style={{ marginBottom: 8 }}>
        {TIP_TAGS.map((t) => (
          <button key={t.id} type="button" className={`chip${tags.includes(t.id) ? ' selected' : ''}`} aria-pressed={tags.includes(t.id)} onClick={() => toggleTag(t.id)}>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {preview ? (
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
          <img src={preview} alt="Your tip's photo" style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
          <button type="button" className="chip-remove" aria-label="Remove photo" onClick={removePhoto} style={{ position: 'absolute', top: -6, right: -6 }}>
            ×
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={addPhoto} style={{ marginBottom: 8 }}>
          {'\u{1F4F8}'} Add a photo (optional)
        </button>
      )}
      {msg && (
        <p className="screen-subtitle" role="alert" style={{ margin: '4px 0 8px' }}>
          {msg}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-primary btn-block" disabled={!ok || busy} aria-busy={busy} onClick={submit}>
          {busy ? 'Sharing…' : 'Share tip'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Not now
          </button>
        )}
      </div>
    </div>
  );
}
