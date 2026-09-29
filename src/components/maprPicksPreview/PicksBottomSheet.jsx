import { useRef } from 'react';
import { MIN_RATINGS_FOR_PICKS, PICKS_SHOWN, SHEET_PICKS } from '../../lib/nearbyPicks';
import PickCard, { PickRow } from './PickCard';

// The sheet over the map. Collapsed (how the app opens) it shows the top
// three picks; swipe up -- or tap the handle -- for the full "Picked for you
// right now" list and whatever the parent passes as children (because you
// liked, mood, meal, nearby). Swipe down to collapse.
//
// state:
//   'ready'       picks (or skeletons while the first set loads)
//   'locked'      under MIN_RATINGS_FOR_PICKS ratings
//   'no-location' location off
// Also: updating (an older set is showing while a new one loads) and slow
// (slow signal: the last set stays on screen).
export const SWIPE_PX = 30;

export default function PicksBottomSheet({
  state = 'ready',
  picks,
  updating = false,
  slow = false,
  expanded,
  onExpandedChange,
  showChainLabels = false,
  toolbar = null,
  children,
}) {
  const startY = useRef(null);
  const onPointerDown = (e) => {
    startY.current = e.clientY;
  };
  const onPointerUp = (e) => {
    if (startY.current == null) return;
    const dy = e.clientY - startY.current;
    startY.current = null;
    if (dy < -SWIPE_PX) onExpandedChange(true);
    else if (dy > SWIPE_PX) onExpandedChange(false);
    else onExpandedChange(!expanded);
  };

  const status = updating ? (
    <span className="mpp-pill" role="status">
      <span className="mpp-pill-dot" /> Updating…
    </span>
  ) : slow ? (
    <span className="mpp-pill mpp-pill-slow" role="status">
      Slow connection · showing your last picks
    </span>
  ) : null;

  let body;
  if (state === 'locked') {
    body = <p className="mpp-empty">Rate {MIN_RATINGS_FOR_PICKS} places and Mapr will start picking for you.</p>;
  } else if (state === 'no-location') {
    body = <p className="mpp-empty">Turn on location to see picks near you.</p>;
  } else if (!picks) {
    body = (
      <ul className="mpp-rows" aria-label="Loading picks">
        {Array.from({ length: expanded ? PICKS_SHOWN : SHEET_PICKS }, (_, i) => (
          <li key={i} className="mpp-row mpp-skeleton" aria-hidden="true">
            <span className="mpp-row-img" />
            <span className="mpp-skeleton-line" />
          </li>
        ))}
      </ul>
    );
  } else if (!picks.length) {
    body = <p className="mpp-empty">Nothing to pick within this distance yet. Try a wider one.</p>;
  } else if (expanded) {
    body = (
      <div className="mpp-list">
        {picks.slice(0, PICKS_SHOWN).map((p) => (
          <PickCard key={`${p.region}/${p.id}`} pick={p} showChainLabel={showChainLabels} />
        ))}
      </div>
    );
  } else {
    body = (
      <ul className="mpp-rows">
        {picks.slice(0, SHEET_PICKS).map((p) => (
          <PickRow key={`${p.region}/${p.id}`} pick={p} />
        ))}
      </ul>
    );
  }

  return (
    <section className={`mpp-sheet ${expanded ? 'expanded' : ''}`} aria-label="Picked for you right now">
      <div
        className="mpp-sheet-grip"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse picks' : 'Show all picks'}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onExpandedChange(!expanded);
          }
        }}
      >
        <span className="mpp-handle" />
        <div className="mpp-sheet-head">
          <h2 className="mpp-sheet-title">Picked for you right now</h2>
          {status}
        </div>
      </div>
      <div className="mpp-sheet-scroll">
        {expanded && state === 'ready' && toolbar}
        {body}
        {expanded && state === 'ready' && children}
      </div>
    </section>
  );
}
