import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useTrip } from '../lib/TripContext';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { useFavorites } from '../lib/FavoritesContext';
import { FAVORITE_NOTE_MAX } from '../lib/favorites';
import { getRegion } from '../data/regions';
import { addGroupPlace, listMyGroupTrips, removeGroupPlace, toggleGroupLandmark } from '../lib/groupTrips';

// The bookmark, outlined until the place is saved, then filled.
export function BookmarkIcon({ filled = false, size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.6L5.5 20.5v-16a1 1 0 0 1 1-1z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Instagram-style save. Tapping the bookmark slides up a sheet with two tabs:
// an itinerary (any you have, this city's first) or Favorites (anywhere in the
// world, with a note of your own, listed in Itinerary > Favorites). The bookmark is filled once the place is a favorite (or was saved
// for later before that list was replaced by favorites).
export default function SaveLandmarkButton({ landmark, regionId, className = 'share-icon-btn' }) {
  const { isSavedForLater } = useTrip();
  const { isFavorite } = useFavorites();
  const [open, setOpen] = useState(false);
  const saved = isFavorite(regionId, landmark.id) || isSavedForLater(regionId, landmark.id);

  const onClick = (e) => {
    e?.stopPropagation?.();
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        className={`${className} ${saved ? 'is-saved' : ''}`}
        onClick={onClick}
        aria-haspopup="dialog"
        aria-label={saved ? `Saved. Change how ${landmark.name} is saved` : `Save ${landmark.name}`}
        title={saved ? 'Saved' : 'Save'}
      >
        <BookmarkIcon filled={saved} />
      </button>
      {open && <SaveSheet landmark={landmark} regionId={regionId} onClose={() => setOpen(false)} />}
    </>
  );
}

// A landmark going on another city's itinerary rides along as a place
// (like a Mapr find), carrying its home city and id so the stop still opens
// its page for check-in and rating.
export function landmarkAsPlace(landmark, regionId) {
  return {
    id: `lm:${regionId}:${landmark.id}`,
    name: landmark.name,
    address: landmark.address || '',
    lat: landmark.lat,
    lng: landmark.lng,
    url: '',
    fromRegion: regionId,
    landmarkId: landmark.id,
  };
}

function SaveSheet({ landmark, regionId, onClose }) {
  const { isSavedForLater, unsaveForLater } = useTrip();
  const { isFavorite } = useFavorites();
  const onLater = isSavedForLater(regionId, landmark.id);
  // Two ways to save, as two tabs: an itinerary, or your Favorites.
  const [tab, setTab] = useState('itinerary');
  const tabs = (
    <div className="tabs save-sheet-tabs" role="tablist" aria-label="How to save">
      {[
        { id: 'itinerary', label: '\u{1F5FA}\u{FE0F} Itinerary' },
        { id: 'favorites', label: `${isFavorite(regionId, landmark.id) ? '\u{2705}' : '\u{2B50}'} Favorites` },
      ].map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          className={`tab-btn ${tab === t.id ? 'active' : ''}`}
          onClick={() => setTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
  return (
    <ItinerarySheet
      landmark={landmark}
      regionId={regionId}
      onClose={onClose}
      head={
        <>
          <BookmarkIcon filled size={22} />
          <div>
            <strong>Save</strong>
            <div className="save-sheet-sub">{landmark.name}</div>
          </div>
        </>
      }
      before={tabs}
      replaceList={tab === 'favorites' ? <FavoriteSection landmark={landmark} regionId={regionId} /> : null}
      label="Add it to an itinerary"
      secondary={
        onLater ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => unsaveForLater(regionId, landmark.id)}>
            Remove from Save for later
          </button>
        ) : (
          <span />
        )
      }
    />
  );
}

// Favorites: one tap to keep the place, then a note of your own ("great
// pizza, ask for the garlic knots") that shows under it on its page and in
// Itinerary > Favorites.
function FavoriteSection({ landmark, regionId }) {
  const { signedIn, isFavorite, getFavorite, add, remove, setNote } = useFavorites();
  const toast = useToast();
  const on = isFavorite(regionId, landmark.id);
  const saved = getFavorite(regionId, landmark.id);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const note = draft ?? saved?.note ?? '';
  const dirty = on && draft !== null && draft !== (saved?.note || '');

  const toggle = async () => {
    setBusy(true);
    try {
      if (on) {
        await remove(regionId, landmark.id);
        setDraft(null);
      } else {
        await add({ region: regionId, id: landmark.id, name: landmark.name, lat: landmark.lat, lng: landmark.lng, note: draft || '' });
      }
    } catch {
      toast?.show(`Couldn't ${on ? 'remove' : 'save'} ${landmark.name}. Try again.`);
    } finally {
      setBusy(false);
    }
  };
  const saveNote = async () => {
    setBusy(true);
    try {
      await setNote(regionId, landmark.id, note);
      setDraft(null);
      toast?.show('Note saved.', { tone: 'success', durationMs: 2000 });
    } catch {
      toast?.show("Couldn't save your note. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn) {
    return (
      <div className="save-sheet-fav">
        <p className="screen-subtitle" style={{ margin: '12px 0 0' }}>
          <Link to="/profile">Sign in</Link> to keep favorites with your own notes.
        </p>
      </div>
    );
  }
  return (
    <div className="save-sheet-fav">
      <button type="button" className={`save-sheet-row ${on ? 'on' : ''}`} disabled={busy} onClick={toggle}>
        <span>
          {'\u{2B50}'} {on ? 'In your Favorites' : 'Add to Favorites'}
          <span className="save-sheet-row-sub">Find it again anywhere, with a note</span>
        </span>
        <span className="save-sheet-mark">{on ? '\u{2713}' : '+'}</span>
      </button>
      <textarea
        className="rating-comment save-sheet-note"
        aria-label={`Your note about ${landmark.name}`}
        placeholder="Add a note, like “Great pizza, ask for the garlic knots”"
        rows={3}
        maxLength={FAVORITE_NOTE_MAX}
        value={note}
        onChange={(e) => setDraft(e.target.value)}
      />
      {dirty && (
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={saveNote}>
          Save note
        </button>
      )}
      {!on && draft && <p className="screen-subtitle" style={{ margin: '4px 0 0' }}>Tap Add to Favorites above to keep this note.</p>}
    </div>
  );
}

// Every itinerary you have, solo or group, in any city: this city's first
// (or "Start a <city> itinerary" when you have none), then the rest. A
// landmark joins its own city's list as a stop and any other as a place.
export function ItinerarySheet({ landmark, regionId, onClose, head, before = null, replaceList = null, label = 'Add it to an itinerary', secondary = <span /> }) {
  const { trip, addLandmark, removeLandmark, addPlace, removePlace, itineraryName, regionsWithItineraries } = useTrip();
  const { user } = useAuth();
  const toast = useToast();
  const city = getRegion(regionId);
  const place = landmarkAsPlace(landmark, regionId);
  const [groups, setGroups] = useState(null);

  useEffect(() => {
    if (!user?.uid) return undefined;
    let live = true;
    listMyGroupTrips(user.uid)
      .then((all) => live && setGroups(all))
      .catch(() => live && setGroups([]));
    return () => {
      live = false;
    };
  }, [user?.uid]);

  const soloOn = (rid) =>
    rid === regionId
      ? (trip.byRegion?.[rid] || []).includes(landmark.id)
      : (trip.placesByRegion?.[rid] || []).some((p) => p.id === place.id);
  const toggleSolo = (rid) => {
    if (rid === regionId) (soloOn(rid) ? removeLandmark : addLandmark)(landmark.id, rid);
    else if (soloOn(rid)) removePlace(rid, place.id);
    else addPlace(rid, place);
  };
  const otherRegions = regionsWithItineraries().filter((rid) => rid !== regionId && getRegion(rid));
  const hasHere = regionsWithItineraries().includes(regionId);

  const groupOn = (g) =>
    g.regionId === regionId ? (g.landmarkIds || []).includes(landmark.id) : (g.places || []).some((p) => p.id === place.id);
  const toggleGroup = async (g) => {
    const add = !groupOn(g);
    const sameCity = g.regionId === regionId;
    setGroups((cur) =>
      cur.map((x) => {
        if (x.id !== g.id) return x;
        if (sameCity)
          return { ...x, landmarkIds: add ? [...(x.landmarkIds || []), landmark.id] : (x.landmarkIds || []).filter((id) => id !== landmark.id) };
        return { ...x, places: add ? [...(x.places || []), place] : (x.places || []).filter((p) => p.id !== place.id) };
      })
    );
    try {
      if (sameCity) await toggleGroupLandmark(g, landmark.id, add);
      else if (add) await addGroupPlace(g, place);
      else await removeGroupPlace(g, place.id);
    } catch {
      setGroups((cur) => cur.map((x) => (x.id === g.id ? g : x)));
      toast?.show(`Couldn't update ${g.name}. Try again.`);
    }
  };
  const sortedGroups = [...(groups || [])].sort((a, b) => (b.regionId === regionId) - (a.regionId === regionId));

  const row = (key, text, sub, on, onClick) => (
    <button key={key} type="button" className={`save-sheet-row ${on ? 'on' : ''}`} onClick={onClick}>
      <span>
        {text}
        {sub && <span className="save-sheet-row-sub">{sub}</span>}
      </span>
      <span className="save-sheet-mark">{on ? '\u{2713}' : '+'}</span>
    </button>
  );
  const cityName = (rid) => getRegion(rid)?.name || '';
  const subFor = (rid, name) => (cityName(rid) && cityName(rid) !== name ? cityName(rid) : null);

  return createPortal(
    <div className="modal-backdrop save-sheet-backdrop" onClick={onClose}>
      <div className="modal-card save-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={label}>
        {head && <div className="save-sheet-head">{head}</div>}
        {before}
        {replaceList}
        {!replaceList && <p className="save-sheet-label">{label}</p>}
        {!replaceList && <div className="save-sheet-list">
          {/* A pin far from every curated city has no city itinerary to start. */}
          {(city || hasHere) &&
            row(
              'solo-here',
              hasHere ? itineraryName(regionId) : `Start a ${city?.name || 'new'} itinerary`,
              hasHere ? subFor(regionId, itineraryName(regionId)) : null,
              soloOn(regionId),
              () => toggleSolo(regionId)
            )}
          {sortedGroups
            .filter((g) => g.regionId === regionId)
            .map((g) => row(g.id, `\u{1F465} ${g.name}`, subFor(g.regionId, g.name), groupOn(g), () => toggleGroup(g)))}
          {otherRegions.map((rid) =>
            row(`solo-${rid}`, itineraryName(rid), subFor(rid, itineraryName(rid)), soloOn(rid), () => toggleSolo(rid))
          )}
          {sortedGroups
            .filter((g) => g.regionId !== regionId)
            .map((g) => row(g.id, `\u{1F465} ${g.name}`, subFor(g.regionId, g.name), groupOn(g), () => toggleGroup(g)))}
        </div>}
        <div className="save-sheet-actions">
          {secondary}
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
