// "Photo: <author> via Google Maps" credit that Google Maps Platform requires
// wherever a Places photo is shown. The author name links to their Google
// Maps profile. `compact` (tiny thumbnails) shows just a small (c) badge whose
// link/title carries the full credit; use the full form wherever there's room.
export function creditText(photo) {
  const names = (photo?.attributions || []).map((a) => a.name).filter(Boolean);
  return `Photo: ${names.length ? names.join(', ') : 'Google Maps contributor'} via Google Maps`;
}

function openAuthor(e, uri) {
  // Often rendered inside a card-wide button: don't trigger that button, and
  // open the profile ourselves (a link nested in a button isn't reliably followed).
  e.stopPropagation();
  e.preventDefault();
  if (uri) window.open(uri, '_blank', 'noopener,noreferrer');
}

export default function PlacePhotoCredit({ photo, compact = false, className = '' }) {
  if (!photo) return null;
  const first = photo.attributions?.[0];
  const text = creditText(photo);
  if (compact) {
    return (
      <a
        className={`place-photo-credit place-photo-credit-compact ${className}`}
        href={first?.uri || undefined}
        target="_blank"
        rel="noopener noreferrer"
        title={text}
        aria-label={text}
        onClick={(e) => openAuthor(e, first?.uri)}
      >
        {'©'}
      </a>
    );
  }
  return (
    <span className={`place-photo-credit ${className}`}>
      Photo:{' '}
      {(photo.attributions || []).length === 0 && 'Google Maps contributor'}
      {(photo.attributions || []).map((a, i) => (
        <span key={`${a.name}-${i}`}>
          {i > 0 && ', '}
          {a.uri ? (
            <a href={a.uri} target="_blank" rel="noopener noreferrer" onClick={(e) => openAuthor(e, a.uri)}>
              {a.name}
            </a>
          ) : (
            a.name
          )}
        </span>
      ))}{' '}
      via Google Maps
    </span>
  );
}
