import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFavorites } from '../lib/FavoritesContext';
import { useToast } from '../lib/ToastContext';
import { getRegion } from '../data/regions';
import { FAVORITE_NOTE_MAX } from '../lib/favorites';
import DirectionsButton from './DirectionsButton';

const cityOf = (f) => getRegion(f.region)?.name || 'Other places';

// The Favorites sub-tab of Itinerary: every place you kept, with your own
// note, filtered by city, searched, and sorted, so you never dig through
// photos to remember that great pizza place.
export default function FavoritesList() {
  const toast = useToast();
  const { favorites, ready, signedIn, add, remove, setNote } = useFavorites();
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('all');
  const [sort, setSort] = useState('newest');
  const [editing, setEditing] = useState(null); // { key, text }

  const cities = useMemo(() => {
    const counts = new Map();
    for (const f of favorites) counts.set(cityOf(f), (counts.get(cityOf(f)) || 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [favorites]);
  // A city whose last favorite was removed stops filtering.
  const activeCity = city !== 'all' && cities.some(([c]) => c === city) ? city : 'all';

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = favorites.filter((f) => activeCity === 'all' || cityOf(f) === activeCity);
    if (q) rows = rows.filter((f) => `${f.name} ${f.note || ''} ${cityOf(f)}`.toLowerCase().includes(q));
    if (sort === 'az') rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    const byCity = new Map();
    for (const f of rows) {
      if (!byCity.has(cityOf(f))) byCity.set(cityOf(f), []);
      byCity.get(cityOf(f)).push(f);
    }
    return [...byCity.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [favorites, query, activeCity, sort]);

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
      toast?.show(`Removed ${f.name} from Favorites.`, {
        tone: 'info',
        actionLabel: 'Undo',
        onAction: () => add({ region: f.region, id: f.id, name: f.name, lat: f.lat, lng: f.lng, note: f.note || '' }).catch(() => {}),
      });
    } catch {
      toast?.show(`Couldn't remove ${f.name}. Try again.`);
    }
  };

  if (!signedIn) {
    return (
      <p className="screen-subtitle">
        <Link to="/profile">Sign in</Link> to keep favorite places with your own notes.
      </p>
    );
  }
  if (!ready) return <p className="screen-subtitle">Loading…</p>;
  if (favorites.length === 0) {
    return (
      <p className="screen-subtitle">
        Nothing here yet. Tap the bookmark on any place, choose Favorites, and add a note so you remember why you loved it.
      </p>
    );
  }

  return (
    <div>
      <p className="screen-subtitle" style={{ marginTop: 0 }}>
        {favorites.length} {favorites.length === 1 ? 'place' : 'places'}, with your notes. Only you can see this.
      </p>
      <input
        type="search"
        className="itin-search"
        name="favorites-search"
        aria-label="Search favorite places"
        autoComplete="off"
        placeholder={'\u{1F50D} Search places, notes or cities…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="favorites-filters">
        <select aria-label="Filter by city" value={activeCity} onChange={(e) => setCity(e.target.value)}>
          <option value="all">All cities ({favorites.length})</option>
          {cities.map(([c, n]) => (
            <option key={c} value={c}>
              {c} ({n})
            </option>
          ))}
        </select>
        <select aria-label="Sort favorites" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="az">A to Z</option>
        </select>
      </div>
      {groups.length === 0 && <p className="screen-subtitle">No favorites match that.</p>}
      {groups.map(([cityName, items]) => (
            <div key={cityName} style={{ marginBottom: 18 }}>
              <p className="itin-where" style={{ margin: '0 0 8px' }}>
                {'\u{1F4CD}'} {cityName}
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
    </div>
  );
}
