import { useState } from 'react';
import { useFavorites } from '../lib/FavoritesContext';
import { useToast } from '../lib/ToastContext';
import { FAVORITE_NOTE_MAX } from '../lib/favorites';

// Under a favorite place's title: your own note about it ("great pizza, ask
// for the garlic knots"), editable right here. Only you see it.
export default function FavoriteNoteCard({ regionId, landmarkId }) {
  const { getFavorite, setNote } = useFavorites();
  const toast = useToast();
  const fav = getFavorite(regionId, landmarkId);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!fav) return null;
  const note = draft ?? fav.note ?? '';
  const dirty = draft !== null && draft !== (fav.note || '');

  const save = async () => {
    setBusy(true);
    try {
      await setNote(regionId, landmarkId, note);
      setDraft(null);
      toast?.show('Note saved.', { tone: 'success', durationMs: 2000 });
    } catch {
      toast?.show("Couldn't save your note. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card section favorite-note" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>{'\u{2B50}'} Your favorite</h3>
      <textarea
        className="rating-comment"
        aria-label="Your note about this place"
        placeholder="Add a note, like “Great pizza, ask for the garlic knots”"
        rows={3}
        maxLength={FAVORITE_NOTE_MAX}
        value={note}
        onChange={(e) => setDraft(e.target.value)}
        style={{ width: '100%', resize: 'vertical' }}
      />
      {dirty && (
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save} style={{ marginTop: 8 }}>
          {busy ? 'Saving…' : 'Save note'}
        </button>
      )}
      <p className="screen-subtitle" style={{ margin: '8px 0 0', fontSize: '0.8rem' }}>
        Only you can see this. Find all your favorites in the Itinerary tab, under Favorites.
      </p>
    </div>
  );
}
