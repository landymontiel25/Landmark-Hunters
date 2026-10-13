import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTrip } from '../lib/TripContext';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { getRegion } from '../data/regions';
import { listMyGroupTrips, toggleGroupLandmark } from '../lib/groupTrips';

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
// sheet to also put it on an itinerary: this city's own itinerary (or start
// one) and any group trip you're on there. Tapping a saved bookmark unsaves
// it, with Undo.
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

function SaveSheet({ landmark, regionId, onClose }) {
  const { trip, addLandmark, removeLandmark, itineraryName, unsaveForLater } = useTrip();
  const { user } = useAuth();
  const toast = useToast();
  const city = getRegion(regionId);
  const onSolo = (trip.byRegion?.[regionId] || []).includes(landmark.id);
  const hasSolo = !!trip.byRegion?.[regionId]?.length || !!trip.placesByRegion?.[regionId]?.length;
  const [groups, setGroups] = useState(null);

  useEffect(() => {
    if (!user?.uid) return undefined;
    let live = true;
    listMyGroupTrips(user.uid)
      .then((all) => live && setGroups(all.filter((g) => g.regionId === regionId)))
      .catch(() => live && setGroups([]));
    return () => {
      live = false;
    };
  }, [user?.uid, regionId]);

  const toggleGroup = async (g) => {
    const add = !(g.landmarkIds || []).includes(landmark.id);
    setGroups((cur) =>
      cur.map((x) =>
        x.id === g.id
          ? { ...x, landmarkIds: add ? [...(x.landmarkIds || []), landmark.id] : (x.landmarkIds || []).filter((id) => id !== landmark.id) }
          : x
      )
    );
    try {
      await toggleGroupLandmark(g, landmark.id, add);
    } catch {
      setGroups((cur) => cur.map((x) => (x.id === g.id ? g : x)));
      toast?.show(`Couldn't update ${g.name}. Try again.`);
    }
  };

  return createPortal(
    <div className="modal-backdrop save-sheet-backdrop" onClick={onClose}>
      <div className="modal-card save-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Saved">
        <div className="save-sheet-head">
          <BookmarkIcon filled size={22} />
          <div>
            <strong>Saved to Save for later</strong>
            <div className="save-sheet-sub">{landmark.name}</div>
          </div>
        </div>
        <p className="save-sheet-label">Also add it to an itinerary</p>
        <button
          type="button"
          className={`save-sheet-row ${onSolo ? 'on' : ''}`}
          onClick={() => (onSolo ? removeLandmark(landmark.id, regionId) : addLandmark(landmark.id, regionId))}
        >
          <span>{hasSolo ? itineraryName(regionId) : `Start a ${city?.name || 'new'} itinerary`}</span>
          <span className="save-sheet-mark">{onSolo ? '\u{2713}' : '+'}</span>
        </button>
        {(groups || []).map((g) => {
          const on = (g.landmarkIds || []).includes(landmark.id);
          return (
            <button key={g.id} type="button" className={`save-sheet-row ${on ? 'on' : ''}`} onClick={() => toggleGroup(g)}>
              <span>
                {'\u{1F465}'} {g.name}
              </span>
              <span className="save-sheet-mark">{on ? '\u{2713}' : '+'}</span>
            </button>
          );
        })}
        <div className="save-sheet-actions">
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
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
