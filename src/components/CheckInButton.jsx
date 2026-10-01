import { useGeo } from '../lib/GeoContext';
import { checkinBlockReason, radiusFor } from '../lib/checkinRules';

// Opens the rate + post prompt (CheckInReview) — the check-in itself isn't
// registered until Post is tapped there. Gated on GPS: you must be within
// the landmark's radius (checkInRadiusMeters, default CHECKIN_RADIUS_METERS)
// of its real coordinates -- a photo alone was never real proof you went.
// Reads location itself via useGeo() rather than taking it as a prop: the
// marker lists that render this are memoized to skip rebuilding on every GPS
// tick (avoids the open popup flashing/closing), so a coords prop would go
// stale right when it matters most -- mid check-in.
//
// The GPS gate is the one switch REQUIRE_GPS_CHECKIN in maprConstants.js
// (off by default); rules live in checkinRules.js. CheckInContext enforces
// the same rule again when Post is tapped.

export default function CheckInButton({ landmark, user, firebaseEnabled, claimedMap, checkingIn, onCheckIn, className = '' }) {
  const { coords } = useGeo();
  if (!firebaseEnabled) return null;

  // "Visited before" is just a badge now, not a lock -- unlimited repeat
  // check-ins are allowed (see leaderboard.js's taperedPoints/home-radius),
  // so a prior visit never disables the button.
  const alreadyVisited = !!claimedMap[landmark.id];
  const busy = checkingIn === landmark.id;
  const radius = radiusFor(landmark);
  const hasPosition = landmark.lat != null && landmark.lng != null;
  const reason = hasPosition ? checkinBlockReason(coords, landmark) : null;
  const noLocation = reason === 'no-location' || reason === 'weak-signal';
  const tooFar = reason === 'too-far';

  const handleClick = () => {
    if (!user || busy || noLocation || tooFar) return;
    onCheckIn(landmark);
  };

  // While the server confirms the claim, say so in words (not a bare
  // "…") -- the server is still what decides whether it counted.
  const label = busy
    ? '\u{23F3} Checking in…'
    : !user
    ? 'Sign in to Check In'
    : noLocation
    ? 'Enable location to check in'
    : tooFar
    ? 'Get closer to check in'
    : alreadyVisited
    ? `\u{1F4CD} Check In Again`
    : "\u{1F4CD} Check In";

  return (
    <button
      type="button"
      className={`btn btn-sm ${alreadyVisited ? 'btn-success' : 'btn-primary'} ${busy ? 'is-busy' : ''} ${className}`}
      disabled={!user || busy || noLocation || tooFar}
      aria-busy={busy}
      title={!user ? 'Sign in to check in' : tooFar ? `You need to be within ${radius}m of this spot` : 'Check in'}
      onClick={handleClick}
    >
      {label}
    </button>
  );
}
