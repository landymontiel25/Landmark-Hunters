import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useCheckIn } from '../lib/useCheckIn';
import { useGeo } from '../lib/GeoContext';
import { useRatings } from '../lib/RatingsContext';
import { TIERS } from '../lib/ratingFlow';
import { landmarkForRating } from '../lib/placeLandmarks';
import { friendlyError } from '../lib/friendlyError';

// "How was it?" under a Mapr reply, when you told Mapr you just left a
// place. One tap on a tier opens the usual rate prompt with that tier
// already picked, as a 0-point rating (same as Profile's "Rate a
// Landmark") -- no check-in needed. Collapses once you've rated it.
export default function MaprRateCard({ place }) {
  const { user, resendVerification } = useAuth();
  const { checkIn } = useCheckIn();
  const { coords } = useGeo();
  const { myReviews } = useRatings();
  const [busyTier, setBusyTier] = useState(null);
  const [error, setError] = useState(null);
  const [landmarkId, setLandmarkId] = useState(place.id || null);
  // Only a rating saved after this card appeared counts as done -- an older
  // one still gets the chance to update.
  const [shownAt] = useState(() => Date.now() / 1000);
  const review = landmarkId ? myReviews?.[landmarkId] : null;

  if (!user) return null;
  if (review?.ratingTier && (review.updatedAt?.seconds || 0) >= shownAt) {
    return <p className="mapr-rate-done">{'\u{2705}'} Rated {place.name}. Thanks, I learn from every rating.</p>;
  }

  const rate = async (tierId) => {
    setBusyTier(tierId);
    setError(null);
    try {
      const landmark = await landmarkForRating(place, { near: coords, user, resendVerification });
      setLandmarkId(landmark.id);
      checkIn(landmark, { ratingOnly: true, requireComment: true, initialTier: tierId });
    } catch (e) {
      setError(friendlyError(e, `Couldn't open a rating for ${place.name}. Try again.`));
    } finally {
      setBusyTier(null);
    }
  };

  return (
    <div className="mapr-rate-card">
      <span className="mapr-rate-title">
        {'\u{2B50}'} How was {place.name}?
      </span>
      <div className="mapr-rate-tiers">
        {TIERS.map((t) => (
          <button key={t.id} type="button" disabled={!!busyTier} onClick={() => rate(t.id)}>
            {busyTier === t.id ? 'Opening…' : `${t.emoji} ${t.label}`}
          </button>
        ))}
      </div>
      {error && <p className="mapr-rate-error">{error}</p>}
    </div>
  );
}
