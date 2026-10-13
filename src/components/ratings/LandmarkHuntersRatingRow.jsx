import { formatCount } from '../../lib/ratingSources';

// The app's own rating (landmark_ratings average), shown as the third row
// once RATINGS_FLAGS.landmarkHunters is on. `agg` is { avg, count } from
// RatingsContext; no network call.
export default function LandmarkHuntersRatingRow({ agg }) {
  if (!agg?.count) return null;
  return (
    <div className="ratings-row ratings-row-lh" data-source="landmarkHunters">
      <div className="ratings-row-head">
        <span className="ratings-source-name">Landmark Hunters</span>
        <span className="ratings-score">
          <span className="ratings-star" aria-hidden="true">
            {'★'}
          </span>
          {agg.avg.toFixed(1)}
        </span>
        <span className="ratings-count">({formatCount(agg.count)} ratings)</span>
      </div>
    </div>
  );
}
