import { Link } from 'react-router-dom';
import { useTrip } from '../lib/TripContext';
import { useToast } from '../lib/ToastContext';
import { getLandmark, getRegion } from '../data/regions';
import { BookmarkIcon } from './SaveLandmarkButton';

// The "Save for later" itinerary: every place you bookmarked, newest first,
// grouped by city. Each can go onto that city's itinerary in one tap, or be
// unsaved.
export default function SavedForLater({ onBack }) {
  const { trip, addLandmark, unsaveForLater, saveForLater, itineraryName } = useTrip();
  const toast = useToast();
  const saved = trip.savedForLater || [];
  const byCity = new Map();
  for (const s of saved) {
    if (!byCity.has(s.regionId)) byCity.set(s.regionId, []);
    byCity.get(s.regionId).push(s);
  }

  return (
    <div>
      <button type="button" className="btn btn-ghost btn-sm back-sticky" onClick={onBack} style={{ marginBottom: 16 }}>
        {'← Back'}
      </button>
      <h1 className="screen-title">
        <span>{'\u{1F516}'}</span> Save for later
      </h1>
      {saved.length === 0 ? (
        <p className="screen-subtitle">Nothing saved yet. Tap the bookmark on any place to save it here.</p>
      ) : (
        <p className="screen-subtitle">
          {saved.length} saved {saved.length === 1 ? 'place' : 'places'}. Add one to its city's itinerary when you're ready to go.
        </p>
      )}
      {[...byCity.entries()].map(([rid, items]) => (
        <div key={rid} style={{ marginBottom: 18 }}>
          <p className="itin-where" style={{ margin: '0 0 8px' }}>
            {'\u{1F4CD}'} {getRegion(rid)?.name || 'Other places'}
          </p>
          {items.map((s) => {
            const l = getLandmark(rid, s.id);
            const name = l?.name || s.name || 'Saved place';
            const onItin = (trip.byRegion?.[rid] || []).includes(s.id);
            return (
              <div key={s.id} className="card saved-row">
                <Link to={`/landmarks/${rid}/${s.id}`} className="saved-row-name">
                  {name}
                </Link>
                <div className="saved-row-actions">
                  <button
                    type="button"
                    className={`btn btn-sm ${onItin ? 'btn-success' : 'btn-ghost'}`}
                    disabled={onItin}
                    onClick={() => {
                      addLandmark(s.id, rid);
                      toast?.show(`Added to ${itineraryName(rid)}.`, { tone: 'success' });
                    }}
                  >
                    {onItin ? `\u{2713} On ${itineraryName(rid)}` : `+ ${itineraryName(rid)} itinerary`}
                  </button>
                  <button
                    type="button"
                    className="share-icon-btn is-saved"
                    aria-label={`Remove ${name} from Save for later`}
                    title="Unsave"
                    onClick={() => {
                      unsaveForLater(rid, s.id);
                      toast?.show(`Removed ${name}.`, { tone: 'info', actionLabel: 'Undo', onAction: () => saveForLater(rid, s.id, name) });
                    }}
                  >
                    <BookmarkIcon filled />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
