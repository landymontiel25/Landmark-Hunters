import { usePlacePhoto } from '../lib/usePlacePhoto';
import PlacePhotoCredit from './PlacePhotoCredit';

// Hero image of a swipeable pick card (Mapr Travel Picks, streak vote cards):
// the landmark's own photo, else a lazily fetched Google Places photo with its
// credit; with neither, a plain tile (no icon).
export default function MaprPickImage({ landmark }) {
  const own = landmark.images?.[0];
  const place = usePlacePhoto(landmark, { enabled: !landmark.images?.length });
  if (own) return <img className="mapr-pick-img" src={own} alt="" loading="lazy" />;
  if (place.photo) {
    return (
      <span className="mapr-pick-img mapr-pick-photo-host">
        <img src={place.photo.url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={place.onError} />
        <PlacePhotoCredit photo={place.photo} />
      </span>
    );
  }
  return (
    <div ref={place.ref} className={`mapr-pick-img mapr-pick-img-blank photo-tile ${place.missing ? 'is-none' : 'is-pending'}`}>
      {place.missing && <span className="no-image-label">No photo yet</span>}
    </div>
  );
}
