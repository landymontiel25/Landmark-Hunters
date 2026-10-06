import { useEffect, useRef } from 'react';

// Calls onShown(items) once per distinct list of items a row puts on screen
// (the rows render only while the sheet is open). logShownPicks dedupes per
// set and place, so a re-render never logs twice.
export function useShownEffect(onShown, items) {
  const ref = useRef({ onShown, items });
  ref.current = { onShown, items };
  const sig = (items || []).map((p) => `${p.region || p.regionId}/${p.id}`).join('|');
  useEffect(() => {
    if (sig && ref.current.onShown) ref.current.onShown(ref.current.items);
  }, [sig]);
}
