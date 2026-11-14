// Shared parts of the New UI (docs/design-language.md) for the live screens.
// The Test tab's reference build (src/screens/NewUILab.jsx) has the same
// shapes; styles live in src/styles/new-ui-live.css under .nl-*.

// The Mapr line: the gold spark, then one or two sentences from Mapr.
export function MaprLine({ children }) {
  return (
    <div className="nl-mapr" role="note" aria-label="Mapr">
      <svg className="nl-spark" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2c.9 5.6 3.4 8.2 10 10-6.6 1.8-9.1 4.4-10 10-.9-5.6-3.4-8.2-10-10 6.6-1.8 9.1-4.4 10-10z" />
      </svg>
      <p>{children}</p>
    </div>
  );
}

// Your progress: a gold arc on a hairline circle, with "found/total" inside.
export function ProgressRing({ found, total, size = 56, count = true }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const share = total > 0 ? Math.min(1, found / total) : 0;
  return (
    <div className="nl-ring" style={{ width: size, height: size }} role="img" aria-label={`${found} of ${total} found`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="nl-ring-track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="nl-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - share)} />
      </svg>
      {count && (
        <span>
          <strong>{found}</strong>/{total}
        </span>
      )}
    </div>
  );
}

// Up to three photos of a trip's stops: one tall on the left, two stacked.
export function TripPhotos({ places = [] }) {
  const shown = places.slice(0, 3);
  return (
    <span className="nl-trip-photos" aria-hidden="true">
      {shown.length === 0 && <span className="nl-trip-photo" />}
      {shown.map((p, i) => (
        <span key={p.id || i} className="nl-trip-photo">
          {p.images?.[0] ? <img src={p.images[0]} alt="" loading="lazy" /> : null}
        </span>
      ))}
    </span>
  );
}
