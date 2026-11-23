import { useUnits, formatDistance } from '../lib/UnitsContext';
import DirectionsButton from './DirectionsButton';
import ErrorNotice from './ErrorNotice';
import { Skeleton } from './Skeleton';

const minutes = (sec) => Math.max(1, Math.round(sec / 60));

// How the route was planned (api/directions.js mode, or BOAT from boatRoute.js).
const MODE_LABEL = {
  WALK: '\u{1F6B6} Walking',
  DRIVE: '\u{1F697} Driving',
  BICYCLE: '\u{1F6B2} Biking',
  TRANSIT: '\u{1F68C} By bus',
  BOAT: '\u{26F5} By boat',
};

function formatDuration(sec) {
  const m = minutes(sec);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} hr${m % 60 ? ` ${m % 60} min` : ''}`;
}

// In-app turn-by-turn for one stop (data from api/directions.js): total
// distance and ETA, how much live traffic is adding when driving, and every
// step. Start (onStart) switches to live navigation that follows you.
// Apple/Google Maps stay one tap away as a fallback.
export default function TurnByTurnPanel({ stop, loading, error, data, onRefresh, onClose, onStart }) {
  const { units } = useUnits();
  const trafficMin =
    data?.mode === 'DRIVE' && data.staticDurationSeconds
      ? minutes(data.durationSeconds) - minutes(data.staticDurationSeconds)
      : 0;

  return (
    <div className="card turn-panel">
      <div className="turn-panel-head">
        <h3 style={{ margin: 0 }}>
          {'\u{1F9ED}'} To {stop.name}
        </h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          {'\u{2715}'} Close
        </button>
      </div>

      {/* Placeholder ETA line and steps, the shape the directions arrive in. */}
      {loading && (
        <div role="status" aria-live="polite">
          <span className="visually-hidden">Finding the best route…</span>
          <div className="turn-panel-summary" aria-hidden="true">
            <Skeleton width={80} height={26} radius={8} />
            <Skeleton width={120} height={14} />
          </div>
          <div className="turn-panel-skeleton-steps" aria-hidden="true">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} width={`${85 - n * 12}%`} height={13} />
            ))}
          </div>
        </div>
      )}

      {error && !loading && (
        <div>
          {/* error is already a plain-language sentence (see Itinerary's startNav). */}
          <ErrorNotice message={error} onRetry={onRefresh} compact />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <DirectionsButton name={stop.name} lat={stop.lat} lng={stop.lng} mode={stop.mode} className="btn btn-ghost btn-sm" external>
              Open in Maps App
            </DirectionsButton>
          </div>
        </div>
      )}

      {data && !loading && !error && (
        <>
          <div className="turn-panel-summary">
            <span className="turn-panel-eta">{formatDuration(data.durationSeconds)}</span>
            <span>
              {formatDistance(data.distanceMeters, units)} · {MODE_LABEL[data.mode] || MODE_LABEL.DRIVE}
            </span>
            {data.mode === 'DRIVE' && (
              <span className={`tag ${trafficMin >= 5 ? 'tag-error' : ''}`}>
                {trafficMin > 0 ? `+${trafficMin} min from traffic` : 'Traffic is light'}
              </span>
            )}
          </div>

          <ol className="turn-steps">
            {data.steps
              .filter((s) => s.instruction)
              .map((s, i) => (
                <li key={i}>
                  <span>{s.instruction}</span>
                  {s.distanceMeters > 0 && <span className="turn-step-dist">{formatDistance(s.distanceMeters, units)}</span>}
                </li>
              ))}
            <li className="turn-step-arrive">
              <span>
                {'\u{1F3C1}'} Arrive at {stop.name}
              </span>
            </li>
          </ol>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {onStart && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onStart}>
                {'\u{25B6}\u{FE0F}'} Start
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
              {'\u{1F504}'} Refresh from Here
            </button>
            <DirectionsButton name={stop.name} lat={stop.lat} lng={stop.lng} mode={stop.mode} className="btn btn-ghost btn-sm" external>
              Open in Maps App
            </DirectionsButton>
          </div>
        </>
      )}
    </div>
  );
}
