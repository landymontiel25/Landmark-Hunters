// Admin Mode: reorder a landmark's photos. The first photo is the cover (the
// one list rows, the map and the top of the landmark page show), so the owner
// can move a better shot to the front. Up/Down buttons instead of drag so it
// works the same on a phone as on a desktop. The list math is in
// lib/moveImage so it can be tested without rendering.
import { moveImage } from '../lib/moveImage';

export default function AdminImageOrder({ images, onChange }) {
  const list = (images || []).filter((src) => typeof src === 'string' && src.trim());
  if (list.length < 2) return null;

  // `list` drops blank entries; move within it and hand back the new order.
  const move = (from, to) => onChange(moveImage(list, from, to));

  return (
    <div className="field" data-testid="admin-image-order">
      <label>Photo order</label>
      <p className="screen-subtitle" style={{ marginTop: -2, marginBottom: 8 }}>
        The first photo is the cover. Move a photo up to show it first, then tap Save Changes.
      </p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((src, i) => (
          <li
            key={`${i}-${src}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: 6,
              border: '1px solid var(--color-border-soft)',
              borderRadius: 10,
              background: 'var(--color-bg-card)',
            }}
          >
            <span style={{ width: 18, textAlign: 'center', fontSize: '0.8rem', color: 'var(--color-parchment-dim)' }}>{i + 1}</span>
            <img
              src={src}
              alt=""
              loading="lazy"
              style={{ width: 64, height: 44, objectFit: 'cover', borderRadius: 6, background: 'var(--color-bg-raised)', flexShrink: 0 }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '0.75rem',
                color: 'var(--color-parchment-dim)',
              }}
            >
              {i === 0 ? 'Cover · ' : ''}
              {src.replace(/^https?:\/\//, '')}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label={`Move photo ${i + 1} up`}
              disabled={i === 0}
              onClick={() => move(i, i - 1)}
            >
              {'↑'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label={`Move photo ${i + 1} down`}
              disabled={i === list.length - 1}
              onClick={() => move(i, i + 1)}
            >
              {'↓'}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
