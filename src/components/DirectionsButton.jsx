import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { appleMapsLink, googleMapsLink } from '../lib/routing';
import { lookupPlace } from '../lib/placeLookup';

// Every "Get Directions" in the app opens this sheet: use the app's own map
// (turn-by-turn from api/directions.js), Google Maps, or Apple Maps. "Use the
// Map" jumps to the Map tab with the route drawn (MapExplore reads
// location.state.directionsTo), unless the screen has its own map and passes
// onInApp (Itinerary). `external` hides it, for the fallback buttons inside
// the directions panel itself.
//
// Places without coordinates (Mapr's web-found stops) pass `query` instead:
// Google/Apple Maps search it by text right away, and "Open in Map" looks the
// spot up (Google Places, biased toward `near`, the traveler's location)
// when the sheet opens.
export default function DirectionsButton({
  name,
  lat,
  lng,
  className = 'btn btn-ghost btn-sm',
  style,
  children,
  onInApp,
  external = false,
  query,
  near,
}) {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState(null); // { lat, lng } looked up from `query`
  const [lookup, setLookup] = useState('idle'); // idle | looking | failed
  const hasCoords = lat != null && lng != null;
  const destLat = hasCoords ? lat : found?.lat;
  const destLng = hasCoords ? lng : found?.lng;
  const destText = query || name;

  const findSpot = async () => {
    if (hasCoords || !query || found) return;
    setLookup('looking');
    try {
      const spot = await lookupPlace(query, near);
      setFound({ lat: spot.lat, lng: spot.lng });
      setLookup('idle');
    } catch {
      setLookup('failed');
    }
  };
  const navigate = useNavigate();
  const close = (e) => {
    e?.stopPropagation?.();
    setOpen(false);
  };
  const openOnMap = (e) => {
    close(e);
    if (onInApp) onInApp();
    else navigate('/', { state: { directionsTo: { name, lat: destLat, lng: destLng } } });
  };
  return (
    <>
      <button
        type="button"
        className={className}
        style={style}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
          findSpot();
        }}
      >
        {children ?? `${'\u{1F9ED}'} Directions`}
      </button>
      {open &&
        createPortal(
          <div className="modal-backdrop" onClick={close}>
            <div className="modal-card directions-sheet" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0 }}>{'\u{1F9ED}'} Directions to {name}</h3>
              {!external && (hasCoords || query) && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary btn-block directions-choice"
                    onClick={openOnMap}
                    disabled={destLat == null || destLng == null}
                  >
                    {'\u{1F5FA}\u{FE0F}'} {lookup === 'looking' ? 'Finding it on the map…' : 'Open in Map'}
                  </button>
                  {lookup === 'failed' && (
                    <p className="screen-subtitle" style={{ margin: '-4px 0 10px', fontSize: '0.82rem' }}>
                      Couldn't pin this spot on our map. Google Maps or Apple Maps will still find it.{' '}
                      <button type="button" className="link-button" onClick={findSpot}>
                        Try again
                      </button>
                    </p>
                  )}
                </>
              )}
              <a className="btn btn-primary btn-block directions-choice" href={googleMapsLink(destText, destLat, destLng)} target="_blank" rel="noreferrer" onClick={close}>
                {'\u{1F310}'} Open in Google Maps
              </a>
              <a className="btn btn-primary btn-block directions-choice" href={appleMapsLink(destText, destLat, destLng)} target="_blank" rel="noreferrer" onClick={close}>
                {'\u{1F34E}'} Open in Apple Maps
              </a>
              <button type="button" className="btn btn-ghost btn-block" onClick={close}>
                Cancel
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
