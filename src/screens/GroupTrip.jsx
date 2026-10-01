import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useTrip } from '../lib/TripContext';
import { useCheckIn } from '../lib/useCheckIn';
import { useGeo } from '../lib/GeoContext';
import { itineraryPhase, groupKey } from '../lib/itineraryStatus';
import { getRegion } from '../data/regions';
import {
  subscribeGroupTrip,
  toggleGroupLandmark,
  setGroupLandmarks,
  reorderGroupLandmarks,
  addGroupMember,
  removeGroupMember,
  deleteGroupTrip,
  renameGroupTrip,
  removeGroupPlace,
  MAX_GROUP_MEMBERS,
} from '../lib/groupTrips';
import { orderStops, annotateRoute } from '../lib/routing';
import { useDragReorder } from '../lib/useDragReorder';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import AddMemberSheet from '../components/AddMemberSheet';
import EditableTitle from '../components/EditableTitle';
import DirectionsButton from '../components/DirectionsButton';
import CheckInButton from '../components/CheckInButton';
import LandmarkThumb from '../components/LandmarkThumb';
import { friendlyError } from '../lib/friendlyError';
import { writePersisted, usePersistentState } from '../lib/usePersistentState';
import { useStopAddresses } from '../lib/useStopAddresses';
import { useRatings } from '../lib/RatingsContext';
import { runOptimistic, useToast } from '../lib/ToastContext';
import ErrorNotice from '../components/ErrorNotice';
import { Skeleton, SkeletonList } from '../components/Skeleton';

// Same outline as the loaded screen: back button, title, members card,
// landmarks card.
function GroupTripSkeleton() {
  return (
    <div className="skeleton-screen" role="status" aria-live="polite">
      <span className="visually-hidden">Loading group trip…</span>
      <Skeleton width={120} height={30} radius={999} style={{ marginBottom: 12 }} />
      <Skeleton width="55%" height={30} radius={10} style={{ marginBottom: 10 }} />
      <Skeleton width="70%" height={14} style={{ marginBottom: 18 }} />
      <div className="card section">
        <Skeleton width="30%" height={18} style={{ marginBottom: 12 }} />
        <SkeletonList count={2} label="Loading members" />
      </div>
      <div className="card section">
        <Skeleton width="45%" height={18} style={{ marginBottom: 12 }} />
        <SkeletonList count={4} label="Loading landmarks" />
      </div>
    </div>
  );
}

// One trip a few friends build together (item i6) -- a single shared
// landmark list, live-updated for every member via subscribeGroupTrip.
export default function GroupTrip() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [trip, setTrip] = useState(null);
  // 'loading' | 'ready' | 'missing' (deleted, or you're not a member --
  // Firestore can't tell us which) | 'error' (couldn't reach it; retryable)
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  // Landmark ticks you've made that the server hasn't confirmed yet, so the
  // checkbox flips the instant you tap it. { [landmarkId]: true | false }
  const [pendingLandmarks, setPendingLandmarks] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { trip: myTrip, setMapFocus, setMapFocusStops, setItineraryStatus } = useTrip();
  const { claimedMap, checkingIn, checkIn, firebaseEnabled } = useCheckIn();
  const { coords } = useGeo();
  const { units } = useUnits();
  const { ratings } = useRatings();
  // Same "Edit List" + nearest-by-default behavior as the solo Itinerary
  // route -- a group trip is the same kind of itinerary, just with more
  // people on it, so it shouldn't behave differently. No sort preference to
  // remember until someone's actually used Edit List once.
  const [sortPref, setSortPref] = usePersistentState(trip?.id ? `itin-sort-pref.group-${trip.id}` : null, null);
  const [editing, setEditing] = useState(false);
  const sort = editing ? 'custom' : sortPref || 'nearest';

  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return undefined;
    setStatus('loading');
    setLoadError(null);
    const unsub = subscribeGroupTrip(
      tripId,
      (data) => {
        setTrip(data);
        setStatus(data ? 'ready' : 'missing');
      },
      (err) => {
        const code = String(err?.code || '');
        if (code === 'permission-denied' || code === 'not-found') {
          setStatus('missing');
        } else {
          setLoadError(err);
          setStatus('error');
        }
      }
    );
    return unsub;
  }, [tripId, uid, attempt]);

  // Street address under each landmark -- the trip's own stops first.
  const addressStops = useMemo(() => {
    const ls = (trip?.regionId && getRegion(trip.regionId)?.landmarks) || [];
    const ids = new Set(trip?.landmarkIds || []);
    return [...ls.filter((l) => ids.has(l.id)), ...ls.filter((l) => !ids.has(l.id))];
  }, [trip]);
  const addresses = useStopAddresses(addressStops);

  // Tapping Map from here frames this trip's city, then every stop in it.
  useEffect(() => {
    if (!trip?.regionId) return;
    const region = getRegion(trip.regionId);
    const ids = trip.landmarkIds || [];
    const pts = [...(region?.landmarks || []).filter((l) => ids.includes(l.id)), ...(trip.places || [])]
      .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
      .map((p) => ({ lat: p.lat, lng: p.lng }));
    setMapFocus(trip.regionId);
    setMapFocusStops(pts.length ? pts : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip]);

  const back = (
    <button className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={() => navigate('/itinerary')}>
      {'← Itineraries'}
    </button>
  );

  // Computed unconditionally (with safe fallbacks) since useDragReorder
  // below is a hook -- it has to run every render, loading or not, in the
  // same order every time. landmarkIds' own array order IS the drag order,
  // same as byRegion for a solo trip (see reorderLandmarks in TripContext.jsx).
  const regionSafe = trip?.regionId ? getRegion(trip.regionId) : null;
  const landmarkIdsSafe = trip?.landmarkIds || [];
  const isSelectedSafe = (id) => (id in pendingLandmarks ? pendingLandmarks[id] : landmarkIdsSafe.includes(id));
  const selectedLandmarks = (regionSafe?.landmarks || []).filter((l) => isSelectedSafe(l.id));
  const selectedIdsKey = selectedLandmarks.map((l) => l.id).join(',');
  const route = useMemo(() => {
    if (!selectedLandmarks.length) return [];
    if (!coords) {
      // No GPS yet: just respect the saved order, unannotated -- distance
      // sorts and leg distances need an origin we don't have.
      const byId = new Map(selectedLandmarks.map((l) => [l.id, l]));
      const ordered = landmarkIdsSafe.map((id) => byId.get(id)).filter(Boolean);
      const placed = new Set(ordered.map((l) => l.id));
      return [...ordered, ...selectedLandmarks.filter((l) => !placed.has(l.id))];
    }
    return annotateRoute(coords, orderStops(sort, coords, selectedLandmarks, ratings, landmarkIdsSafe));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdsKey, sort, coords?.lat, coords?.lng, ratings, landmarkIdsSafe.join(',')]);
  const stopsById = useMemo(() => Object.fromEntries(route.map((s) => [s.id, s])), [route]);
  const stopIds = useMemo(() => route.map((s) => s.id), [route]);
  const { order: dragOrder, registerNode, startDrag, keyReorder, draggingId, dragY, shifts } = useDragReorder(stopIds, (newIds) => {
    // A refused/dropped write used to vanish silently, leaving the new order
    // on screen for you while everyone else (and a reopen) still had the old one.
    if (trip) {
      reorderGroupLandmarks(trip, newIds).catch((e) =>
        toast.show(friendlyError(e, "Couldn't save the new order. Try again."))
      );
    }
  });
  const orderedRoute = dragOrder.map((id) => stopsById[id]).filter(Boolean);

  if (authLoading || (user && status === 'loading')) return <GroupTripSkeleton />;

  if (!user) {
    return (
      <div>
        {back}
        <div className="empty-state">
          <p>
            <Link to="/profile">Sign in</Link> to see this group trip.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div>
        {back}
        <ErrorNotice
          error={loadError}
          message={friendlyError(loadError, "Couldn't load this group trip.")}
          onRetry={() => setAttempt((a) => a + 1)}
        />
      </div>
    );
  }

  if (status === 'missing' || !trip) {
    return (
      <div>
        {back}
        <div className="empty-state">
          <p>{'\u{1F465}'} This group trip isn't available. It may have been deleted, or you're not a member of it.</p>
        </div>
      </div>
    );
  }

  const region = getRegion(trip.regionId);
  const isOwner = trip.ownerUid === user.uid;
  // Every write path stores landmarkIds/memberUids as arrays, but never
  // trust a remote document that fully -- a doc from an older schema, or
  // one edited outside the app, shouldn't crash this screen.
  const landmarkIds = trip.landmarkIds || [];
  const memberUids = trip.memberUids || [];
  const isSelected = (id) => (id in pendingLandmarks ? pendingLandmarks[id] : landmarkIds.includes(id));
  const selectedCount = (region?.landmarks || []).filter((l) => isSelected(l.id)).length;

  const setLandmark = (landmark, add) => {
    const clearPending = () =>
      setPendingLandmarks((cur) => {
        const next = { ...cur };
        delete next[landmark.id];
        return next;
      });
    runOptimistic({
      apply: () => setPendingLandmarks((cur) => ({ ...cur, [landmark.id]: add })),
      commit: () => toggleGroupLandmark(trip, landmark.id, add).then(clearPending),
      rollback: clearPending,
      toast,
      errorMessage: `Couldn't ${add ? 'add' : 'remove'} ${landmark.name}, so we put it back.`,
      retry: () => setLandmark(landmark, add),
    });
  };

  const regionLandmarks = region?.landmarks || [];
  const allSelected = regionLandmarks.length > 0 && selectedCount === regionLandmarks.length;
  const setAll = (add) => {
    const ids = regionLandmarks.filter((l) => isSelected(l.id) !== add).map((l) => l.id);
    if (!ids.length) return;
    const clearPending = () =>
      setPendingLandmarks((cur) => {
        const next = { ...cur };
        ids.forEach((id) => delete next[id]);
        return next;
      });
    runOptimistic({
      apply: () => setPendingLandmarks((cur) => ({ ...cur, ...Object.fromEntries(ids.map((id) => [id, add])) })),
      commit: () => setGroupLandmarks(trip, ids, add).then(clearPending),
      rollback: clearPending,
      toast,
      errorMessage: add ? "Couldn't select them all, so we put the list back." : "Couldn't clear the list, so we put it back.",
      retry: () => setAll(add),
    });
  };

  // Member changes show up right away through Firestore's own local copy of
  // the trip (the snapshot above fires before the server confirms) and are
  // undone the same way if the write is refused -- this just makes sure a
  // refusal is said out loud, with a way to try again.
  const addMember = (m) =>
    runOptimistic({
      commit: () => addGroupMember(trip, m.uid, m.name).then(() => toast.show(`Added ${m.name} to ${trip.name}.`, { tone: 'success', durationMs: 3000 })),
      toast,
      errorMessage: `Couldn't add ${m.name || 'them'}. Try again.`,
      retry: () => addMember(m),
    });
  const rename = (name) =>
    runOptimistic({
      commit: () => renameGroupTrip(trip, name),
      toast,
      errorMessage: "Couldn't rename the trip. Try again.",
      retry: () => rename(name),
    });
  const removePlace = (place) =>
    runOptimistic({
      commit: () => removeGroupPlace(trip, place.id),
      toast,
      errorMessage: `Couldn't remove ${place.name}. Try again.`,
      retry: () => removePlace(place),
    });
  const removeMember = (memberUid) =>
    runOptimistic({
      commit: () => removeGroupMember(trip, memberUid),
      toast,
      errorMessage: `Couldn't remove ${trip.memberNames?.[memberUid] || 'that member'}. Try again.`,
      retry: () => removeMember(memberUid),
    });
  // Every stop on the trip (ticked landmarks + Mapr-found places) for the
  // Map's route view, which orders them from where you are.
  const tripStops = [
    ...(region?.landmarks || []).filter((l) => isSelected(l.id)),
    ...(trip.places || []),
  ]
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
    .map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng }));
  const viewInMap = () => navigate('/', { state: { tripRoute: { name: trip.name, stops: tripStops } } });

  // Leave right away; the delete finishes in the background. If it's
  // refused, say so (the trip is still there) and offer to try again.
  const deleteTrip = () => {
    const id = trip.id;
    const name = trip.name;
    navigate('/itinerary');
    deleteGroupTrip(id).catch((e) =>
      toast.show(friendlyError(e, `Couldn't delete ${name}. It's still there.`), {
        actionLabel: 'Retry',
        onAction: () => deleteGroupTrip(id).catch((err) => toast.show(friendlyError(err))),
      })
    );
  };

  return (
    <div>
      {back}
      <EditableTitle value={trip.name} onSave={rename} prefix={<span>{'\u{1F465}'}</span>} label="Rename group trip" />
      <p className="screen-subtitle">{region?.name} — a trip you're building together</p>

      <div className="card section">
        <h3 style={{ marginTop: 0 }}>Members</h3>
        {memberUids.map((memberUid) => (
          <div key={memberUid} className="friend-row">
            <span>
              {trip.memberNames?.[memberUid] || 'A traveler'}
              {memberUid === trip.ownerUid ? ' (owner)' : ''}
            </span>
            {isOwner && memberUid !== trip.ownerUid && (
              <button className="btn btn-ghost btn-tight" onClick={() => removeMember(memberUid)}>
                Remove
              </button>
            )}
          </div>
        ))}
        {/* Always the last row, under whoever joined most recently. */}
        {memberUids.length >= MAX_GROUP_MEMBERS ? (
          <p className="screen-subtitle" style={{ marginBottom: 0 }}>
            This trip is full: a group trip fits up to {MAX_GROUP_MEMBERS} people.
          </p>
        ) : (
          <button type="button" className="member-add-row" onClick={() => setShowAdd(true)}>
            {'\u{2795}'} Add
          </button>
        )}
        {showAdd && (
          <AddMemberSheet
            title={`Add someone to ${trip.name}`}
            excludeUids={memberUids}
            onPick={(m) => addMember(m)}
            onClose={() => setShowAdd(false)}
          />
        )}
      </div>

      <div className="card section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>
            {'\u{1F5FA}\u{FE0F}'} Your Route ({selectedCount})
          </h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
            {tripStops.length > 0 && (
              <button type="button" className="btn btn-primary btn-sm" onClick={viewInMap}>
                {'\u{1F5FA}\u{FE0F}'} View in Map
              </button>
            )}
            {!editing && sortPref && (
              <label className="itin-sort">
                <span>Sort by</span>
                <select className="radius-select" value={sortPref} onChange={(e) => setSortPref(e.target.value)}>
                  <option value="nearest">Nearest to me</option>
                  <option value="custom">My order</option>
                </select>
              </label>
            )}
            {selectedCount > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (editing) {
                    setSortPref('custom');
                    setEditing(false);
                  } else {
                    if (trip) {
                      reorderGroupLandmarks(trip, orderedRoute.map((s) => s.id)).catch((e) =>
                        toast.show(friendlyError(e, "Couldn't save your list order. Try again."))
                      );
                    }
                    setEditing(true);
                  }
                }}
              >
                {editing ? `${'\u{2705}'} Done` : `${'✏️'} Edit List`}
              </button>
            )}
          </div>
        </div>
        {orderedRoute.length === 0 && (
          <p className="screen-subtitle" style={{ margin: 0 }}>
            Nothing added yet -- tick landmarks below to build this trip's route.
          </p>
        )}
        {orderedRoute.map((l, idx) => (
          <div
            key={l.id}
            ref={registerNode(l.id)}
            style={{
              transform: `translateY(${draggingId === l.id ? dragY : shifts[l.id] || 0}px)`,
              transition: draggingId === l.id ? 'none' : 'transform 150ms ease',
              position: 'relative',
              zIndex: draggingId === l.id ? 20 : 1,
            }}
          >
            {coords && (idx > 0 || l.distanceFromPrevMeters <= 80000) && (
              <div className="route-travel">
                {l.distanceFromPrevMeters <= 1200 ? '\u{1F6B6}' : '\u{1F697}'} {l.travelMinutesFromPrev || 1} min ·{' '}
                {formatDistance(l.distanceFromPrevMeters, units)} {idx === 0 ? 'from you' : 'from the last stop'}
              </div>
            )}
            <div className={`route-step ${draggingId === l.id ? 'dragging' : ''}`}>
              {sort === 'custom' ? (
                <button
                  type="button"
                  className="remove-dash"
                  title="Remove from trip"
                  aria-label={`Remove ${l.name} from trip`}
                  onClick={() => setLandmark(l, false)}
                >
                  {'−'}
                </button>
              ) : (
                <div className="route-num">{idx + 1}</div>
              )}
              <div className={`card ${claimedMap[l.id] ? 'visited' : ''}`} style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <button
                    type="button"
                    className="route-stop-link"
                    onClick={() => navigate(`/landmarks/${region.id}/${l.id}`)}
                    title={`Open ${l.name}`}
                  >
                    <LandmarkThumb landmark={l} size={44} />
                    <h4 style={{ margin: 0, color: 'var(--color-parchment)' }}>{l.name}</h4>
                  </button>
                  {sort === 'custom' ? (
                    <button
                      type="button"
                      className="drag-handle"
                      title="Hold and drag to reorder"
                      aria-label={`Reorder ${l.name}: hold and drag, or use the up and down arrow keys`}
                      onPointerDown={startDrag(l.id)}
                      onKeyDown={keyReorder(l.id)}
                    >
                      {'☰'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-icon-trash"
                      title="Remove from trip"
                      aria-label="Remove from trip"
                      onClick={() => setLandmark(l, false)}
                    >
                      {'\u{1F5D1}\u{FE0F}'}
                    </button>
                  )}
                </div>
                {addresses[l.id] && <p className="route-address">{'\u{1F4CD}'} {addresses[l.id]}</p>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span className={`tag ${l.free ? 'tag-free' : ''}`}>{l.free ? 'Free to Visit' : 'Ticketed'}</span>
                  {l.typicalMinutes && <span className="tag">{'\u{23F1}\u{FE0F}'} ~{l.typicalMinutes} min there</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <DirectionsButton name={l.name} lat={l.lat} lng={l.lng} className="btn btn-ghost btn-sm">
                    Get Directions
                  </DirectionsButton>
                  {l.free ? (
                    <button className="btn btn-sm" disabled style={{ borderColor: 'var(--color-green)', color: '#bfe0c8' }}>
                      Free to Visit
                    </button>
                  ) : (
                    <a className="btn btn-primary btn-sm" href={l.bookingUrl || '#'} target="_blank" rel="noreferrer">
                      Book Now
                    </a>
                  )}
                  <CheckInButton
                    landmark={l}
                    user={user}
                    firebaseEnabled={firebaseEnabled}
                    claimedMap={claimedMap}
                    checkingIn={checkingIn}
                    onCheckIn={checkIn}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>{'\u{2795}'} Add Landmarks</h3>
          {regionLandmarks.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(!allSelected)}>
              {allSelected ? 'Clear all' : '\u{2705} Select all'}
            </button>
          )}
        </div>
        {regionLandmarks.filter((l) => !isSelected(l.id)).length === 0 && (
          <p className="screen-subtitle" style={{ margin: 0 }}>Every catalog landmark in {region?.name} is already on your route.</p>
        )}
        {regionLandmarks
          .filter((l) => !isSelected(l.id))
          .map((l) => (
            <div key={l.id} className="friend-row">
              <button
                type="button"
                className="shared-landmark-link"
                onClick={() => navigate(`/landmarks/${region.id}/${l.id}`)}
                title={`Open ${l.name}`}
              >
                {l.name}
                {addresses[l.id] && (
                  <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--color-parchment-dim)', marginTop: 2 }}>
                    {'\u{1F4CD}'} {addresses[l.id]}
                  </span>
                )}
              </button>
              <input
                type="checkbox"
                checked={false}
                onChange={() => setLandmark(l, true)}
                style={{ width: 20, height: 20, flexShrink: 0 }}
                aria-label={`Add ${l.name} to the trip`}
              />
            </div>
          ))}
      </div>

      {(trip.places || []).length > 0 && (
        <div className="card section">
          <h3 style={{ marginTop: 0 }}>
            {'\u{1F310}'} Places From Mapr ({trip.places.length})
          </h3>
          {trip.places.map((p) => (
            <div key={p.id} className="friend-row" style={{ alignItems: 'flex-start' }}>
              <span style={{ minWidth: 0 }}>
                <strong>{p.name}</strong>
                {p.address && (
                  <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{p.address}</span>
                )}
              </span>
              <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <DirectionsButton name={p.name} lat={p.lat} lng={p.lng} className="btn btn-ghost btn-tight">
                  {'\u{1F9ED}'}
                </DirectionsButton>
                <button type="button" className="btn btn-ghost btn-tight" aria-label={`Remove ${p.name}`} onClick={() => removePlace(p)}>
                  {'\u{1F5D1}\u{FE0F}'}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {(() => {
        // Current/Past is per person (on this device), not for the whole group.
        const past = itineraryPhase(groupKey(trip.id), landmarkIds, claimedMap, myTrip.itineraryStatus) === 'past';
        return (
          <button
            type="button"
            className="btn btn-ghost btn-block"
            style={{ marginBottom: 12 }}
            onClick={() => {
              setItineraryStatus(groupKey(trip.id), past ? 'current' : 'past');
              writePersisted('itinerary.tab', past ? 'current' : 'past');
              toast.show(`Moved ${trip.name} to ${past ? 'Current' : 'Past'}.`, { tone: 'success' });
              navigate('/itinerary');
            }}
          >
            {past ? `${'\u{21A9}\u{FE0F}'} Move back to Current` : `${'\u{1F4E6}'} Move to Past`}
          </button>
        );
      })()}

      {isOwner && (
        <button type="button" className="btn btn-danger btn-block" onClick={() => setConfirmDelete(true)}>
          {'\u{1F5D1}\u{FE0F}'} Delete This Group Trip
        </button>
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{'\u{1F5D1}\u{FE0F}'} Delete this group trip?</h3>
            <p className="screen-subtitle" style={{ marginTop: 0 }}>
              <strong>{trip.name}</strong> will be deleted for everyone in it. This can't be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-ghost btn-block" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
              <button className="btn btn-danger btn-block" onClick={deleteTrip}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
