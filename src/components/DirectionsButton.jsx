import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { appleMapsLink, googleMapsLink } from '../lib/routing';
import { lookupPlace } from '../lib/placeLookup';
import { readLastFix } from '../lib/lastFix';
import { travelModesFor, effectiveMode, travelMode } from '../lib/travelModes';
import TravelModePicker from './TravelModePicker';

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
//
// "How are you getting around?" (owner, 2026-11-23): the sheet asks the
// itinerary's own question with its own rules (travelModes.js
// travelModesFor, from where you are to this place), so only the ways that
// fit are offered: Boat only for an island place, never Brickell. The pick
// goes to the in-app route and the Google / Apple Maps links. `place`: the
// landmark itself (its region and id say whether it's on an island).
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
  place,
  mode: startMode = null,
}) {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState(null); // { lat, lng } looked up from `query`
  const [lookup, setLookup] = useState('idle'); // idle | looking | failed
  const hasCoords = lat != null && lng != null;
  const destLat = hasCoords ? lat : found?.lat;
  const destLng = hasCoords ? lng : found?.lng;
  const destText = query || name;

  // Where you are: the device's last fix, read when the sheet opens.
  const [here, setHere] = useState(null);
  // startMode: the mode already picked for this trip (the route panel's
  // "Open in Maps App"), so the sheet opens on it.
  const [pickedMode, setPickedMode] = useState(startMode);
  const modeChoice = useMemo(
    () => (destLat != null && destLng != null ? travelModesFor({ origin: here, stops: [{ ...(place || {}), name, lat: destLat, lng: destLng }] }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destLat, destLng, place?.id, place?.region, place?.regionId, here]
  );
  // A mode already picked for this trip always stays on offer: it's never
  // swapped for another (owner, 2026-11-23).
  const offered = modeChoice && startMode && !modeChoice.modes.includes(startMode) ? { ...modeChoice, modes: [...modeChoice.modes, startMode] } : modeChoice;
  const mode = offered ? effectiveMode(pickedMode, offered) : null;
  const googleMode = mode ? travelMode(mode).google : null;
  // Google and Apple Maps have no boat or flight directions.
  const mapsApps = !mode || !!googleMode;

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
    else navigate('/', { state: { directionsTo: { name, lat: destLat, lng: destLng, mode } } });
  };
  return (
    <>
      <button
        type="button"
        className={className}
        style={style}
        onClick={(e) => {
          e.stopPropagation();
          setHere(readLastFix());
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
              {offered && <TravelModePicker modes={offered.modes} value={mode} picked={!!pickedMode} onChange={setPickedMode} />}
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
              {mapsApps ? (
                <>
                  <a className="btn btn-primary btn-block directions-choice" href={googleMapsLink(destText, destLat, destLng, googleMode)} target="_blank" rel="noreferrer" onClick={close}>
                    {'\u{1F310}'} Open in Google Maps
                  </a>
                  <a className="btn btn-primary btn-block directions-choice" href={appleMapsLink(destText, destLat, destLng, mode)} target="_blank" rel="noreferrer" onClick={close}>
                    {'\u{1F34E}'} Open in Apple Maps
                  </a>
                </>
              ) : (
                <p className="screen-subtitle directions-mode-note">Google Maps and Apple Maps don't give {travelMode(mode).label.toLowerCase() === 'fly' ? 'flight' : 'boat'} directions.</p>
              )}
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
