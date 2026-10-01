import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useRatings } from '../lib/RatingsContext';
import { useGeo } from '../lib/GeoContext';
import { useTrip } from '../lib/TripContext';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { submitReview } from '../lib/reviews';
import { TIERS } from '../lib/ratingFlow';
import { MIN_RATINGS_FOR_PICKS } from '../lib/nearbyPicks';
import { onboardingRateQueue } from '../lib/onboardingRatePicks';
import { friendlyError } from '../lib/friendlyError';
import LandmarkThumb from './LandmarkThumb';
import ErrorNotice from './ErrorNotice';

// Onboarding's last real step: rate places, one card at a time, until the
// account has MIN_RATINGS_FOR_PICKS ratings (counting ones it already has),
// which is what unlocks Mapr's picks. A tier tap saves at once through
// submitReview (no comment form); "Haven't been / not sure" skips a place and
// writes nothing. "Do this later" leaves without finishing: Picks then show
// their own "Rate N more" countdown.
export default function OnboardingRateStep({ lovedTags = [], onDone, onLater }) {
  const { user } = useAuth();
  const { myUsername } = useFriends();
  const { myReviews, myReviewsLoaded, reload } = useRatings();
  const { coords } = useGeo();
  const { trip } = useTrip();
  const { units } = useUnits();

  const [added, setAdded] = useState([]); // ids rated in this step
  const [skipped, setSkipped] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Whether the account was already at the bar when ratings first loaded.
  const [alreadyDone, setAlreadyDone] = useState(null);

  const ratedIds = useMemo(() => {
    const ids = new Set(added);
    for (const r of Object.values(myReviews || {})) if (r?.ratingTier && r.landmarkId) ids.add(r.landmarkId);
    return ids;
  }, [myReviews, added]);
  const count = ratedIds.size;

  useEffect(() => {
    if (myReviewsLoaded && alreadyDone === null) setAlreadyDone(count >= MIN_RATINGS_FOR_PICKS);
  }, [myReviewsLoaded, alreadyDone, count]);
  useEffect(() => {
    if (alreadyDone) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadyDone]);

  // Built once, when ratings first load, so the card in front of you never
  // reshuffles under your thumb (a late GPS fix does not rebuild it either).
  const queue = useMemo(
    () =>
      myReviewsLoaded
        ? onboardingRateQueue({ coords, region: trip?.activeRegion || null, lovedTags, excludeIds: [...ratedIds] })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [myReviewsLoaded]
  );
  const place = queue.find((l) => !ratedIds.has(l.id) && !skipped.includes(l.id)) || null;

  const rate = async (tier) => {
    if (!place || saving) return;
    setSaving(true);
    setError(null);
    try {
      await submitReview({
        userId: user.uid,
        userName: myUsername || user.displayName || 'Explorer',
        landmark: place,
        rating: { tier },
      });
      setAdded((a) => [...a, place.id]);
      reload().catch(() => {});
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  if (!myReviewsLoaded || alreadyDone !== false) {
    return <p className="screen-subtitle lab-center nav-clear">Loading…</p>;
  }

  if (count >= MIN_RATINGS_FOR_PICKS) {
    return (
      <div className="lab-center nav-clear">
        <h1 className="screen-title">
          <span>{'\u{1F389}'}</span> Mapr can pick for you
        </h1>
        <p className="screen-subtitle">
          You've rated {count} places. Your picks are unlocked, and every rating from here makes them better.
        </p>
        <button type="button" className="btn btn-primary btn-block" onClick={onDone}>
          Continue {'\u{2192}'}
        </button>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((count / MIN_RATINGS_FOR_PICKS) * 100));
  const meta = [
    place?.neighborhood,
    place?.distanceMeters != null ? `${formatDistance(place.distanceMeters, units)} away` : null,
  ].filter(Boolean);
  const oneLine = place?.summary ? place.summary.split(/(?<=[.!?])\s/)[0] : '';

  return (
    <div className="lab-center nav-clear">
      <h1 className="screen-title">Rate {MIN_RATINGS_FOR_PICKS} places</h1>
      <p className="screen-subtitle" style={{ marginBottom: 8 }}>
        So Mapr can start picking for you. One tap each.
      </p>
      <div className="rating-progress" role="progressbar" aria-valuemin={0} aria-valuemax={MIN_RATINGS_FOR_PICKS} aria-valuenow={count}>
        <strong>
          {count} of {MIN_RATINGS_FOR_PICKS}
        </strong>
        <div className="rating-progress-track">
          <div className="rating-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {place ? (
        <div className="card section" style={{ marginTop: 16 }}>
          <LandmarkThumb key={place.id} landmark={place} width={320} height={170} />
          <h3 style={{ margin: '10px 0 2px' }}>{place.name}</h3>
          {meta.length > 0 && (
            <p className="screen-subtitle" style={{ margin: 0, fontSize: '0.8rem' }}>
              {meta.join(' · ')}
            </p>
          )}
          {oneLine && (
            <p className="screen-subtitle" style={{ margin: '6px 0 0', fontSize: '0.85rem' }}>
              {oneLine}
            </p>
          )}
        </div>
      ) : (
        <p className="screen-subtitle" style={{ marginTop: 16 }}>
          That's every place we have to suggest right now. Rate more any time from the Landmarks tab.
        </p>
      )}

      {error && <ErrorNotice compact message={friendlyError(error, "Couldn't save that. Try again.")} />}

      {place && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="btn btn-primary btn-block"
              style={{ minHeight: 48 }}
              disabled={saving}
              onClick={() => rate(t.id)}
            >
              {t.emoji} {t.label}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-block"
            disabled={saving}
            onClick={() => {
              setError(null);
              setSkipped((s) => [...s, place.id]);
            }}
          >
            Haven't been / not sure
          </button>
        </div>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-tight"
        style={{ marginTop: 14, fontSize: '0.8rem' }}
        disabled={saving}
        onClick={onLater}
      >
        Do this later
      </button>
    </div>
  );
}
