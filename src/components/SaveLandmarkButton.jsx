import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTrip } from '../lib/TripContext';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
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

// Instagram-style save. Tapping the bookmark saves the place to "Save for
// later" (its own list on the Itinerary tab) right away and slides up a
// sheet to also put it on any itinerary you have, this city's first.
// Tapping a saved bookmark unsaves it, with Undo.
export default function SaveLandmarkButton({ landmark, regionId, className = 'share-icon-btn' }) {
  const { isSavedForLater, saveForLater, unsaveForLater } = useTrip();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const saved = isSavedForLater(regionId, landmark.id);

  const onClick = (e) => {
    e?.stopPropagation?.();
    if (saved) {
      unsaveForLater(regionId, landmark.id);
      toast?.show(`Removed ${landmark.name} from Save for later.`, {
        tone: 'info',
        actionLabel: 'Undo',
        onAction: () => saveForLater(regionId, landmark.id, landmark.name),
      });
      return;
    }
    saveForLater(regionId, landmark.id, landmark.name);
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        className={`${className} ${saved ? 'is-saved' : ''}`}
        onClick={onClick}
        aria-pressed={saved}
        aria-label={saved ? `Saved. Remove ${landmark.name} from Save for later` : `Save ${landmark.name} for later`}
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
  const { unsaveForLater } = useTrip();
  return (
    <ItinerarySheet
      landmark={landmark}
      regionId={regionId}
      onClose={onClose}
      head={
        <>
          <BookmarkIcon filled size={22} />
          <div>
            <strong>Saved to Save for later</strong>
            <div className="save-sheet-sub">{landmark.name}</div>
          </div>
        </>
      }
      label="Also add it to an itinerary"
      secondary={
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            unsaveForLater(regionId, landmark.id);
            onClose();
          }}
        >
          Remove from Save for later
        </button>
      }
    />
  );
}

// Every itinerary you have, solo or group, in any city: this city's first
// (or "Start a <city> itinerary" when you have none), then the rest. A
// landmark joins its own city's list as a stop and any other as a place.
export function ItinerarySheet({ landmark, regionId, onClose, head, label = 'Add it to an itinerary', secondary = <span /> }) {
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
        <p className="save-sheet-label">{label}</p>
        <div className="save-sheet-list">
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
        </div>
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
