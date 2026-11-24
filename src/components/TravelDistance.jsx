import { useEffect, useState } from 'react';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { distanceMeters } from '../lib/geo';
import { readLastFix } from '../lib/lastFix';
import { travelDistance, cardTravelMode } from '../lib/travelDistances';

// A card's distance (owner, 2026-11-23): the route distance by the way
// you're going (travelDistances.js), the same number Mapr and the route
// panel give. Nothing shows while it's looked up; the straight line only
// when there's no route at all (or the lookup can't be made).
// origin: where you are (else the phone's last fix). suffix: e.g. " away".
export default function TravelDistance({ place, origin = null, suffix = '', wrap = null }) {
  const { units } = useUnits();
  const from = origin || readLastFix();
  const fromKey = from ? `${from.lat.toFixed(3)},${from.lng.toFixed(3)}` : '';
  const placeKey = place && Number.isFinite(place.lat) ? `${place.lat},${place.lng}` : '';
  const [state, setState] = useState({ key: '', meters: undefined });
  const key = `${fromKey}|${placeKey}`;
  useEffect(() => {
    if (!fromKey || !placeKey) return undefined;
    let live = true;
    cardTravelMode(from)
      .then((mode) => travelDistance(from, place, mode))
      .then((cell) => {
        if (!live) return;
        const straight = distanceMeters(from.lat, from.lng, place.lat, place.lng);
        // null: no route by this mode; undefined: couldn't ask. Either way
        // the straight line is the only number there is.
        setState({ key, meters: cell ? cell.meters : straight });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!fromKey || !placeKey || state.key !== key || state.meters == null) return null;
  const text = `${formatDistance(state.meters, units)}${suffix}`;
  return wrap ? wrap(text) : text;
}
