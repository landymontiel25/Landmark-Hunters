import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useFavorites } from '../lib/FavoritesContext';
import { useToast } from '../lib/ToastContext';
import { getRegion } from '../data/regions';
import { FAVORITE_NOTE_MAX } from '../lib/favorites';
import DirectionsButton from '../components/DirectionsButton';
import { goBack } from '../lib/goBack';

// Profile > Favorite places: every place you kept, grouped by city or
// country, each with your own note, so you never dig through photos to
// remember that great pizza place.
export default function Favorites() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { favorites, ready, signedIn, add, remove, setNote } = useFavorites();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // { key, text }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? favorites.filter((f) => `${f.name} ${f.note || ''} ${getRegion(f.region)?.name || ''}`.toLowerCase().includes(q))
      : favorites;
    const byCity = new Map();
    for (const f of rows) {
      const name = getRegion(f.region)?.name || 'Other places';
      if (!byCity.has(name)) byCity.set(name, []);
      byCity.get(name).push(f);
    }
    return [...byCity.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [favorites, query]);

  const saveNote = async (f, text) => {
    try {
      await setNote(f.region, f.id, text);
      setEditing(null);
    } catch {
      toast?.show("Couldn't save your note. Try again.");
    }
  };
  const drop = async (f) => {
    try {
      await remove(f.region, f.id);
      toast?.show(`Removed ${f.name} from Favorite places.`, {
        tone: 'info',
        actionLabel: 'Undo',
        onAction: () => add({ region: f.region, id: f.id, name: f.name, lat: f.lat, lng: f.lng, note: f.note || '' }).catch(() => {}),
      });
    } catch {
      toast?.show(`Couldn't remove ${f.name}. Try again.`);
    }
  };

  return (
    <div>
      <button type="button" className="btn btn-ghost btn-sm back-sticky" onClick={() => goBack(navigate, location, '/profile')} style={{ marginBottom: 16 }}>
        {'← Back'}
      </button>
      <h1 className="screen-title">
        <span>{'\u{2B50}'}</span> Favorite places
      </h1>
      {!signedIn ? (
        <p className="screen-subtitle">
          <Link to="/profile">Sign in</Link> to keep favorite places with your own notes.
        </p>
      ) : !ready ? (
        <p className="screen-subtitle">Loading…</p>
      ) : favorites.length === 0 ? (
        <p className="screen-subtitle">
          Nothing here yet. Tap the bookmark on any place and choose Favorite places, then add a note so you remember why you loved it.
        </p>
      ) : (
        <>
          <p className="screen-subtitle">
            {favorites.length} {favorites.length === 1 ? 'place' : 'places'}, with your notes. Only you can see this.
          </p>
          <div className="field" style={{ marginBottom: 12 }}>
            <input
              type="search"
              name="favorites-search"
              aria-label="Search favorite places"
              autoComplete="off"
              placeholder={'\u{1F50D} Search places, notes or cities…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {groups.length === 0 && <p className="screen-subtitle">No favorites match that.</p>}
          {groups.map(([city, items]) => (
            <div key={city} style={{ marginBottom: 18 }}>
              <p className="itin-where" style={{ margin: '0 0 8px' }}>
                {'\u{1F4CD}'} {city}
              </p>
              {items.map((f) => {
                const key = `${f.region}__${f.id}`;
                const isEditing = editing?.key === key;
                return (
                  <div key={key} className="card favorite-row">
                    <Link to={`/landmarks/${f.region}/${f.id}`} className="saved-row-name">
                      {f.name}
                    </Link>
                    {isEditing ? (
                      <>
                        <textarea
                          className="rating-comment"
                          aria-label={`Your note about ${f.name}`}
                          rows={3}
                          maxLength={FAVORITE_NOTE_MAX}
                          value={editing.text}
                          onChange={(e) => setEditing({ key, text: e.target.value })}
                          style={{ width: '100%', resize: 'vertical', margin: '8px 0' }}
                        />
                        <div className="saved-row-actions">
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => saveNote(f, editing.text)}>
                            Save note
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {f.note ? <p className="favorite-note-text">{f.note}</p> : <p className="favorite-note-text favorite-note-empty">No note yet.</p>}
                        <div className="saved-row-actions">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ key, text: f.note || '' })}>
                            {f.note ? 'Edit note' : 'Add note'}
                          </button>
                          {Number.isFinite(f.lat) && Number.isFinite(f.lng) && (
                            <DirectionsButton name={f.name} lat={f.lat} lng={f.lng} className="btn btn-ghost btn-sm">
                              {'\u{1F9ED}'} Directions
                            </DirectionsButton>
                          )}
                          <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${f.name} from favorites`} onClick={() => drop(f)}>
                            Remove
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
