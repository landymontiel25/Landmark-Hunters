import { useEffect, useState } from 'react';
import { travelLegs, cardTravelMode } from './travelDistances';

/**
 * A trip's legs measured like the cards (owner, 2026-11-23): by the mode
 * you're using (your last pick, else boat on the water, else driving), by
 * route. legs: [{ from, to }]. Returns { mode, cells } once known, cells[i]
 * being { meters, seconds }, null (no route) or undefined (couldn't ask);
 * null while it's looked up.
 */
export function useTravelLegs(legs) {
  const sig = legs.map((l) => (l?.from && l?.to ? `${l.from.lat.toFixed(4)},${l.from.lng.toFixed(4)}>${l.to.lat.toFixed(5)},${l.to.lng.toFixed(5)}` : '-')).join(';');
  const [state, setState] = useState({ sig: '', value: null });
  useEffect(() => {
    if (!legs.length) return undefined;
    let live = true;
    const from = legs.find((l) => l?.from)?.from || null;
    cardTravelMode(from).then(async (mode) => {
      const cells = await travelLegs(legs, mode);
      if (live) setState({ sig, value: { mode, cells } });
    });
    return () => {
      live = false;
    };
    // legs are captured by sig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return state.sig === sig ? state.value : null;
}
