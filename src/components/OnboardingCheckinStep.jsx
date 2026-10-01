import { useMemo } from 'react';
import { useCheckIn } from '../lib/useCheckIn';
import { useGeo } from '../lib/GeoContext';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { ALL_LANDMARKS } from '../data/regions';
import { placesNearby } from '../lib/firstCheckIn';
import { CHECKIN_MAX_ACCURACY_METERS } from '../lib/maprConstants';
import LandmarkThumb from './LandmarkThumb';
import CheckInButton from './CheckInButton';

// Onboarding's optional first check-in, shown after the 10 ratings. Only
// places the user is really at are offered (inside the place's own radius,
// with a usable GPS fix); with none nearby, no location or a weak signal it
// shows a friendly message and just the skip button. Skip is always there, so
// the step is never a dead end.
export default function OnboardingCheckinStep({ onDone }) {
  const { user, firebaseEnabled, claimedMap, checkingIn, checkIn } = useCheckIn();
  const { coords, loading: geoLoading } = useGeo();
  const { units } = useUnits();

  const nearby = useMemo(() => placesNearby(coords, ALL_LANDMARKS), [coords]);
  const checkedIn = nearby.some((n) => claimedMap[n.landmark.id]);
  const weakSignal = !!coords && !(coords.accuracy <= CHECKIN_MAX_ACCURACY_METERS);

  let message = null;
  if (!coords) {
    message = geoLoading
      ? 'Finding your location…'
      : "We can't see your location, so there's nothing to check in to right now.";
  } else if (!nearby.length) {
    message = weakSignal
      ? "Your GPS signal is too weak to tell where you are. You can check in any time from a place's page."
      : "You're not at one of our places right now. When you're out exploring, the Check In button on a place's page is waiting.";
  }

  return (
    <div className="lab-center nav-clear">
      <h1 className="screen-title">
        <span aria-hidden="true">{'\u{1F4CD}'}</span> Your first check-in
      </h1>
      <p className="screen-subtitle">
        {nearby.length ? "You're right by these. Tap one to log your first visit." : 'This one is optional.'}
      </p>

      {message && (
        <p className="screen-subtitle" role="status">
          {message}
        </p>
      )}

      {nearby.map(({ landmark, meters }) => (
        <div key={landmark.id} className="card section" style={{ textAlign: 'center' }}>
          <LandmarkThumb landmark={landmark} size={96} />
          <h3 style={{ marginBottom: 4 }}>{landmark.name}</h3>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            {formatDistance(meters, units)} away
          </p>
          <CheckInButton
            landmark={landmark}
            user={user}
            firebaseEnabled={firebaseEnabled}
            claimedMap={claimedMap}
            checkingIn={checkingIn}
            onCheckIn={checkIn}
            className="btn-block"
          />
        </div>
      ))}

      <button
        type="button"
        className={`btn btn-block ${checkedIn ? 'btn-primary' : 'btn-ghost'}`}
        style={{ marginTop: 10 }}
        onClick={onDone}
      >
        {checkedIn ? 'Continue' : 'Skip for now'}
      </button>
    </div>
  );
}
