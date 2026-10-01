import { useRef } from 'react';
import { PICKS_SHOWN, ratePlacesText, SHEET_PICKS, distanceUnitLabel } from '../../lib/nearbyPicks';
import { useUnits } from '../../lib/UnitsContext';
import PickCard, { PickRow } from './PickCard';

// The sheet over the map. Collapsed (how the Map opens) it shows the top
// three picks; swipe up -- or tap the handle -- for the full "Picked for you
// right now" list and whatever the parent passes as children (because you
// liked, mood, meal, nearby). Swipe down to collapse, and down again to
// minimize it to just its title (when the parent passes onMinimizedChange);
// swipe up or tap brings it back.
//
// state:
//   'ready'       picks (or skeletons while the first set loads)
//   'locked'      under MIN_RATINGS_FOR_PICKS ratings
//   'no-location' location off
// Also: updating (an older set is showing while a new one loads) and slow
// (offline: the last set stays on screen).
export const SWIPE_PX = 30;

export default function PicksBottomSheet({
  state = 'ready',
  picks,
  updating = false,
  slow = false,
  expanded,
  onExpandedChange,
  minimized = false,
  onMinimizedChange = null,
  showChainLabels = false,
  toolbar = null,
  distanceMiles = null,
  ratingsCount = 0,
  children,
}) {
  const { units } = useUnits();
  const startY = useRef(null);
  const onPointerDown = (e) => {
    startY.current = e.clientY;
  };
  const onPointerUp = (e) => {
    if (startY.current == null) return;
    const dy = e.clientY - startY.current;
    startY.current = null;
    if (minimized) {
      if (dy <= SWIPE_PX) onMinimizedChange?.(false);
    } else if (dy < -SWIPE_PX) onExpandedChange(true);
    else if (dy > SWIPE_PX) {
      if (expanded) onExpandedChange(false);
      else onMinimizedChange?.(true);
    } else onExpandedChange(!expanded);
  };
  const toggle = () => {
    if (minimized) onMinimizedChange?.(false);
    else onExpandedChange(!expanded);
  };

  const status = updating ? (
    <span className="mpp-pill" role="status">
      <span className="mpp-pill-dot" /> Updating…
    </span>
  ) : slow ? (
    <span className="mpp-pill mpp-pill-slow" role="status">
      Offline · showing your last picks
    </span>
  ) : null;

  let body;
  if (state === 'locked') {
    body = <p className="mpp-empty">{ratePlacesText(ratingsCount)} and Mapr will start picking for you.</p>;
  } else if (state === 'no-location') {
    body = <p className="mpp-empty">Turn on location to see picks near you.</p>;
  } else if (!picks && slow) {
    body = <p className="mpp-empty">You're offline. Picks will show once you're back online.</p>;
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
    <section
      className={`mpp-sheet ${expanded && !minimized ? 'expanded' : ''} ${minimized ? 'minimized' : ''}`}
      aria-label="Picked for you right now"
    >
      <div
        className="mpp-sheet-grip"
        role="button"
        tabIndex={0}
        aria-expanded={expanded && !minimized}
        aria-label={minimized ? 'Show picks' : expanded ? 'Collapse picks' : 'Show all picks'}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span className="mpp-handle" />
        <div className="mpp-sheet-head">
          <h2 className="mpp-sheet-title">Picked for you right now</h2>
          {status}
        </div>
      </div>
      {/* Outside the swipeable grip, so tapping it doesn't also trigger a
          swipe toggle. Visible collapsed too -- the distance filter itself
          only shows once expanded, and without this a traveler has no way
          to tell (or change) how far "right now" is actually searching,
          easy to confuse with the map's own unrelated zoom radius control. */}
      {!minimized && state === 'ready' && distanceMiles != null && (
        <button type="button" className="mpp-pill mpp-pill-distance" onClick={() => onExpandedChange(true)}>
          Within {distanceMiles} {distanceUnitLabel(units)}
        </button>
      )}
      <div className="mpp-sheet-scroll">
        {expanded && state === 'ready' && toolbar}
        {body}
        {expanded && state === 'ready' && children}
      </div>
    </section>
  );
}
