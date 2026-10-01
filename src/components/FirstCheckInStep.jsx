import { useCheckIn } from '../lib/useCheckIn';
import { useGeo } from '../lib/GeoContext';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { ALL_LANDMARKS } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import LandmarkThumb from './LandmarkThumb';
import CheckInButton from './CheckInButton';

// Onboarding's first check-in: the nearest landmark to your current GPS fix
// with a one-tap check-in, so a brand-new account earns its first point
// right away. `required` hides Skip: Continue only appears once you've
// checked in there. Part of the removable first-check-in requirement, see
// src/lib/firstCheckIn.js.
export default function FirstCheckInStep({ onDone, required = false }) {
  const { user, firebaseEnabled, claimedMap, checkingIn, checkIn } = useCheckIn();
  const { coords, loading: geoLoading } = useGeo();
  const { units } = useUnits();

  let nearest = null;
  if (coords) {
    for (const l of ALL_LANDMARKS) {
      const d = distanceMeters(coords.lat, coords.lng, l.lat, l.lng);
      if (!nearest || d < nearest.meters) nearest = { landmark: l, meters: d };
    }
  }
  const checkedIn = !!claimedMap[nearest?.landmark?.id];
  // Location denied or unavailable: a check-in is impossible, so the
  // required step must not be a dead end with no button.
  const noLocation = !coords && !geoLoading;

  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F4CD}'}</span> Your First Check-In
      </h1>
      <p className="screen-subtitle">One tap to earn your first point.</p>

      {!coords && (
        <p className="screen-subtitle">{geoLoading ? 'Finding your location…' : "Can't find your location right now."}</p>
      )}

      {nearest && (
        <div className="card section" style={{ textAlign: 'center' }}>
          <LandmarkThumb landmark={nearest.landmark} size={96} />
          <h3 style={{ marginBottom: 4 }}>{nearest.landmark.name}</h3>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            {formatDistance(nearest.meters, units)} away
          </p>
          <CheckInButton
            landmark={nearest.landmark}
            user={user}
            firebaseEnabled={firebaseEnabled}
            claimedMap={claimedMap}
            checkingIn={checkingIn}
            onCheckIn={checkIn}
            className="btn-block"
          />
        </div>
      )}

      {required && !checkedIn && !noLocation && (
        <p className="screen-subtitle" style={{ fontSize: '0.8rem' }}>
          Check in at a landmark to finish setting up. Not at one right now? Come back any time; this will be waiting
          on your Profile tab.
        </p>
      )}
      {noLocation && required && (
        <p className="screen-subtitle" style={{ fontSize: '0.8rem' }}>
          Turn on location for Landmark Hunters to check in. You can do this later from your Profile tab.
        </p>
      )}
      {(!required || checkedIn || noLocation) && (
        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onDone}>
          {checkedIn ? 'Continue' : 'Skip for now'}
        </button>
      )}
    </div>
  );
}
