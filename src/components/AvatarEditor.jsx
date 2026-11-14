import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AVATAR_SIZE, clampOffset, cropRect, removeAvatar, saveAvatar } from '../lib/avatar';

const VIEW = 260; // the squircle frame, in screen px

// Profile picture (owner, 2026-11-14): take a photo or choose one, move and
// zoom it inside a squircle, save it to the account. iPhone first: the two
// buttons open the camera and the photo library.
export default function AvatarEditor({ uid, hasPhoto, onClose, onSaved }) {
  const [img, setImg] = useState(null); // { el, url, width, height }
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cameraRef = useRef(null);
  const libraryRef = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);

  useEffect(() => () => img?.url && URL.revokeObjectURL(img.url), [img]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const open = (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      setError('That file is not a photo.');
      return;
    }
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      setImg({ el, url, width: el.naturalWidth, height: el.naturalHeight });
      setZoom(1);
      setPos({ x: 0, y: 0 });
      setError('');
    };
    el.onerror = () => setError("Couldn't open that photo. Try another one.");
    el.src = url;
  };

  const move = (dx, dy, z = zoom) => setPos((p) => clampOffset(img, VIEW, z, p.x + dx, p.y + dy));
  const setZoomTo = (z) => {
    const next = Math.min(4, Math.max(1, z));
    setZoom(next);
    setPos((p) => clampOffset(img, VIEW, next, p.x, p.y));
  };

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  };
  const onPointerMove = (e) => {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      setZoomTo((pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.dist);
    } else if (pointers.current.size === 1) {
      move(e.clientX - last.x, e.clientY - last.y);
    }
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const { sx, sy, side } = cropRect(img, VIEW, zoom, pos.x, pos.y);
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      canvas.getContext('2d').drawImage(img.el, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
      if (!blob) throw new Error('crop');
      const url = await saveAvatar(uid, blob);
      onSaved?.(url);
      onClose();
    } catch (e) {
      console.error('Avatar save failed:', e?.code, e?.message);
      setError("Couldn't save your picture. Check your connection and try again.");
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removeAvatar(uid);
      onSaved?.(null);
      onClose();
    } catch {
      setError("Couldn't remove it. Try again.");
      setBusy(false);
    }
  };

  const cover = img ? Math.max(VIEW / img.width, VIEW / img.height) * zoom : 1;

  return createPortal(
    <div className="avatar-sheet-backdrop" onClick={() => !busy && onClose()}>
      <div className="avatar-sheet" role="dialog" aria-modal="true" aria-label="Profile picture" onClick={(e) => e.stopPropagation()}>
        <span className="avatar-sheet-grip" aria-hidden="true" />
        <h2 className="avatar-sheet-title">{img ? 'Move and zoom' : 'Profile picture'}</h2>
        {img ? (
          <>
            <div
              className="avatar-crop"
              style={{ width: VIEW, height: VIEW }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={(e) => setZoomTo(zoom * (e.deltaY < 0 ? 1.06 : 0.94))}
            >
              <img
                src={img.url}
                alt=""
                draggable={false}
                style={{
                  width: img.width * cover,
                  height: img.height * cover,
                  transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
                }}
              />
            </div>
            <label className="avatar-zoom">
              <span>Zoom</span>
              <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={(e) => setZoomTo(Number(e.target.value))} aria-label="Zoom" />
            </label>
            <button type="button" className="btn btn-primary btn-block avatar-save" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={() => setImg(null)}>
              Pick another
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost btn-block avatar-choice" onClick={() => cameraRef.current?.click()}>
              Take photo
            </button>
            <button type="button" className="btn btn-ghost btn-block avatar-choice" onClick={() => libraryRef.current?.click()}>
              Choose from library
            </button>
            {hasPhoto && (
              <button type="button" className="btn btn-ghost btn-block avatar-remove" disabled={busy} onClick={remove}>
                Remove picture
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </>
        )}
        {error && (
          <p className="avatar-error" role="alert">
            {error}
          </p>
        )}
        {/* The camera (front-facing) and the photo library, as iOS offers them. */}
        <input ref={cameraRef} type="file" accept="image/*" capture="user" hidden onChange={(e) => open(e.target.files?.[0])} />
        <input ref={libraryRef} type="file" accept="image/*" hidden onChange={(e) => open(e.target.files?.[0])} />
      </div>
    </div>,
    document.body
  );
}
