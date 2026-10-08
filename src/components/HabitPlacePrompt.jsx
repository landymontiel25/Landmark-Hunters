import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useGeo } from '../lib/GeoContext';
import { useTrip } from '../lib/TripContext';
import { useFriends } from '../lib/FriendsContext';
import { reverseGeocodePlace, nearestRegionId, placeId, lookupPlace } from '../lib/placeLookup';
import { distanceMeters } from '../lib/geo';
import { ALL_LANDMARKS } from '../data/regions';
import { notifyUser } from '../lib/notifications';
import { findRelatedStop } from '../lib/habitNearby';
import {
  recordVisit,
  getDueSuggestion,
  typicalTimeLabel,
  recordPrompted,
  resolveClusterName,
  markLookupFailed,
  markClusterAdded,
  dismissCluster,
} from '../lib/habitTracking';

const RECORD_THROTTLE_MS = 60 * 1000; // one GPS fix folded in per minute is plenty for daily-habit clustering
const ALREADY_TRACKED_RADIUS_METERS = 80;

// "Mapr should learn where I go daily" -- this component is the only thing
// that touches habitTracking.js's storage from the UI: it feeds live
// GeoContext fixes in, and when a spot has become a real pattern (and the
// user is standing on it right now) it shows the ask. Mounted globally in
// App.jsx next to the other standing prompts (CheckInReview, TagCapPrompt,
// etc.), so it's live wherever you are in the app, not just on the map.
export default function HabitPlacePrompt() {
  const { user } = useAuth();
  const { coords } = useGeo();
  const { trip, addPlace, addLandmark } = useTrip();
  const { myProfile } = useFriends();
  const uid = user?.uid;
  const enabled = myProfile?.habitTrackingEnabled !== false;
  const [suggestion, setSuggestion] = useState(null);
  const [relatedStop, setRelatedStop] = useState(null);
  const [relatedAdded, setRelatedAdded] = useState(false);
  const [relatedError, setRelatedError] = useState(false);
  const lastRecordedAtRef = useRef(0);
  const notifiedIdRef = useRef(null);
  const relatedFetchedIdRef = useRef(null);
  // Cluster ids whose name lookup is in flight: GPS fixes keep arriving while
  // it runs, and each one would otherwise start another paid lookup.
  const lookupsInFlightRef = useRef(new Set());

  const isAlreadyTracked = (lat, lng) =>
    ALL_LANDMARKS.some((l) => distanceMeters(lat, lng, l.lat, l.lng) <= ALREADY_TRACKED_RADIUS_METERS);

  useEffect(() => {
    if (!uid || !enabled || !coords) return;
    const now = Date.now();
    if (now - lastRecordedAtRef.current < RECORD_THROTTLE_MS) return;
    lastRecordedAtRef.current = now;
    recordVisit(uid, coords);
  }, [uid, enabled, coords]);

  useEffect(() => {
    if (!uid || !enabled || !coords || suggestion) return;
    const due = getDueSuggestion(uid, coords, { isAlreadyTracked });
    if (!due) return;

    if (!due.name) {
      const inFlight = lookupsInFlightRef.current;
      if (inFlight.has(due.id)) return;
      inFlight.add(due.id);
      reverseGeocodePlace(due.lat, due.lng)
        .then((place) => {
          if (place) resolveClusterName(uid, due.id, place);
          else markLookupFailed(uid, due.id);
        })
        .finally(() => inFlight.delete(due.id));
      return;
    }

    setSuggestion(due);
    recordPrompted(uid, due.id);
    if (notifiedIdRef.current !== due.id) {
      notifiedIdRef.current = due.id;
      notifyUser(uid, { type: 'habit_place', message: `You keep going to ${due.name} — want to add it to an itinerary?` }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, enabled, coords, suggestion]);

  // "If I love shooting, is there a shooting range near Dunkin?" -- once the
  // habit place itself is named, ask the same AI behind Mapr chat for ONE
  // extra stop that fits this traveler's taste near it. Fetched at most once
  // per surfaced suggestion (fires as rarely as the habit prompt itself,
  // see habitTracking.js's cooldown), and only when there's an actual taste
  // signal to work from.
  useEffect(() => {
    if (!suggestion || relatedFetchedIdRef.current === suggestion.id) return;
    relatedFetchedIdRef.current = suggestion.id;
    const savedInterests = trip.savedInterests || [];
    const hasTaste = savedInterests.length > 0 || !!myProfile?.tasteIntro;
    if (!hasTaste) return;
    findRelatedStop({
      coords: { lat: suggestion.lat, lng: suggestion.lng },
      placeName: suggestion.name,
      myProfile,
      savedInterests,
      regionId: nearestRegionId(suggestion.lat, suggestion.lng),
    }).then((stop) => {
      // Tagged with its suggestion: an answer that lands after this prompt
      // was closed must not show up later inside a different place's prompt.
      if (stop) setRelatedStop({ ...stop, forSuggestionId: suggestion.id });
    });
  }, [suggestion, trip.savedInterests, myProfile]);

  if (!suggestion) return null;

  const timeLabel = typicalTimeLabel(suggestion);
  const related = relatedStop?.forSuggestionId === suggestion.id ? relatedStop : null;

  const close = () => {
    setSuggestion(null);
    setRelatedStop(null);
    setRelatedAdded(false);
    setRelatedError(false);
  };

  const addToItinerary = () => {
    const regionId = nearestRegionId(suggestion.lat, suggestion.lng);
    if (regionId) {
      addPlace(regionId, {
        id: placeId(suggestion.name, suggestion.lat, suggestion.lng),
        name: suggestion.name,
        lat: suggestion.lat,
        lng: suggestion.lng,
        address: suggestion.address || '',
        source: 'habit',
      });
    }
    markClusterAdded(uid, suggestion.id);
    close();
  };

  const addRelatedStop = async () => {
    setRelatedError(false);
    try {
      if (relatedStop.region && relatedStop.id) {
        addLandmark(relatedStop.id, relatedStop.region);
      } else {
        const near = { lat: suggestion.lat, lng: suggestion.lng };
        const query = [relatedStop.name, relatedStop.address || relatedStop.place].filter(Boolean).join(', ');
        const spot = await lookupPlace(query, near);
        const regionId = nearestRegionId(spot.lat, spot.lng) || nearestRegionId(suggestion.lat, suggestion.lng);
        if (!regionId) throw new Error('Outside tracked cities');
        addPlace(regionId, {
          id: placeId(relatedStop.name, spot.lat, spot.lng),
          name: relatedStop.name,
          lat: spot.lat,
          lng: spot.lng,
          address: relatedStop.address || spot.address || '',
          url: relatedStop.url || '',
        });
      }
      setRelatedAdded(true);
    } catch {
      setRelatedError(true);
    }
  };

  const dismissRelatedStop = () => setRelatedStop(null);

  const alreadyThere = () => {
    markClusterAdded(uid, suggestion.id);
    close();
  };

  const notNow = () => close();

  const stopTracking = () => {
    dismissCluster(uid, suggestion.id);
    close();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="habit-place-title">
        <h3 id="habit-place-title" style={{ marginTop: 0 }}>
          {'\u{1F4CD}'} You keep going here
        </h3>
        <p className="screen-subtitle" style={{ marginTop: 0 }}>
          You've visited <strong>{suggestion.name}</strong>
          {timeLabel ? ` ${timeLabel}` : ''} on {suggestion.days.length} different days. Want to add it to an itinerary?
        </p>
        <button type="button" className="btn btn-block btn-success" onClick={addToItinerary}>
          {'\u{2795}'} Add to Itinerary
        </button>
        <button type="button" className="btn btn-block btn-ghost" style={{ marginTop: 8 }} onClick={alreadyThere}>
          {'\u{2705}'} It's already there
        </button>
        <button type="button" className="btn btn-block btn-ghost" style={{ marginTop: 8 }} onClick={notNow}>
          Not now
        </button>
        <button type="button" className="btn btn-block btn-ghost" style={{ marginTop: 8 }} onClick={stopTracking}>
          {'\u{1F6AB}'} Don't track this place
        </button>

        {related && !relatedAdded && (
          <div className="card section" style={{ marginTop: 16, marginBottom: 0 }}>
            <p className="screen-subtitle" style={{ marginTop: 0 }}>
              {'\u{2728}'} Since you're into that -- <strong>{relatedStop.name}</strong> is nearby or on the way.
              {relatedStop.reason ? ` ${relatedStop.reason}` : ''}
            </p>
            <button type="button" className="btn btn-block btn-success" onClick={addRelatedStop}>
              {'\u{2795}'} Add {relatedStop.name} too
            </button>
            <button type="button" className="btn btn-block btn-ghost" style={{ marginTop: 8 }} onClick={dismissRelatedStop}>
              No thanks
            </button>
            {relatedError && (
              <p className="screen-subtitle" style={{ marginTop: 8 }}>
                Couldn't add that one -- you can still find it and add it from the map.
              </p>
            )}
          </div>
        )}
        {relatedAdded && (
          <p className="screen-subtitle" style={{ marginTop: 16, marginBottom: 0 }}>
            {'\u{2705}'} Added {related?.name} to your itinerary too.
          </p>
        )}
      </div>
    </div>
  );
}
