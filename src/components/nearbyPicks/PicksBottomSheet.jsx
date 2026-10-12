import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PICKS_SHOWN, ratePlacesText, SHEET_PICKS, distanceUnitLabel, PICKS_SHEET_H } from '../../lib/nearbyPicks';
import { useUnits } from '../../lib/UnitsContext';
import { DISTANCE_OPTIONS_MI } from '../../lib/nearbyPicks';
import { formatDistance } from '../../lib/formatDistance';
import PickCard, { PickRow } from './PickCard';
import DirectionsButton from '../DirectionsButton';
import PickVoteButtons from '../PickVoteButtons';
import { usePickVotes } from '../../lib/usePickVotes';

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
//
// layout 'mood-first' (the Test tab): "What are you in the mood for?" (the
// moodSlot) on top, then one card with the top three picks, each with a
// Directions button, and the refresh button beside the card's title.
export const SWIPE_PX = 30;
// Test/Map layout: a flick faster than this (px per ms) goes the way it was
// flicked; a slower drag goes to whichever end it is nearer to.
export const FLICK_PX_PER_MS = 0.4;

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
  beyond = null,
  onWiden = null,
  ratingsCount = 0,
  onRefresh = null,
  refreshing = false,
  layout = 'default',
  moodSlot = null,
  onShown = null,
  uid = null,
  origin = null,
  children,
}) {
  const moodFirst = layout === 'mood-first';
  const { units } = useUnits();
  const navigate = useNavigate();
  const startY = useRef(null);
  const startT = useRef(0);
  const startH = useRef(0);
  const sheetRef = useRef(null);
  // Mood-first layout only: the sheet's live height while a finger is on the
  // handle, so it follows the finger. null = not dragging (CSS sets the height).
  const [dragH, setDragH] = useState(null);
  const dragging = dragH != null;
  const heightBounds = () => ({ min: PICKS_SHEET_H.minimized, max: Math.max(PICKS_SHEET_H.minimized + 1, Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.5)) });

  // The cards actually on screen (1-based rank = position in the set). Nothing
  // while minimized, loading, locked or empty. onShown logs each once per set.
  // "Not for me" takes a card out and the next pick in the same set moves up
  // into the slot. A pick keeps its place in the set as its rank (the
  // replacement is ranked where it sits in the set, and logged when it appears).
  const { votes, removed, vote, retry } = usePickVotes({ uid, origin });
  const queue = picks ? picks.map((p, i) => ({ ...p, rank: i + 1 })).filter((p) => !removed.has(p.id)) : picks;
  const voteSlot = (p) =>
    uid ? (
      <PickVoteButtons name={p.name} vote={votes[p.id]} onVote={(v) => vote({ id: p.id, region: p.region, name: p.name, categories: p.categories || [] }, v)} onRetry={() => retry(p.id)} />
    ) : null;
  const onScreen =
    state === 'ready' && !minimized && queue?.length ? queue.slice(0, expanded && !moodFirst ? PICKS_SHOWN : SHEET_PICKS) : [];
  const onScreenSig = onScreen.map((p) => `${p.region}/${p.id}`).join('|');
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  useEffect(() => {
    if (onScreen.length) onShownRef.current?.(onScreen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScreenSig, onShown]);
  // One drag, from the grip or (pulling down) from the top of the list:
  // begin at a y, follow it, settle where it ends.
  const beginDrag = (y) => {
    startY.current = y;
    startT.current = Date.now();
    startH.current = sheetRef.current?.offsetHeight || (minimized ? heightBounds().min : heightBounds().max);
  };
  const moveDrag = (y) => {
    if (!moodFirst || startY.current == null) return;
    const dy = y - startY.current;
    if (Math.abs(dy) <= 4 && !dragging) return; // still a tap
    const { min, max } = heightBounds();
    setDragH(Math.min(max, Math.max(min, startH.current - dy)));
  };
  const endDrag = (y) => {
    if (startY.current == null) return;
    const dy = y - startY.current;
    startY.current = null;
    if (moodFirst) {
      // Two states only: open (half the screen) and the title bar. The sheet
      // follows the finger (moveDrag) and settles on release: a flick goes
      // the way it was flicked, a slow drag to the nearer end, a tap toggles.
      const { min, max } = heightBounds();
      const endH = Math.min(max, Math.max(min, startH.current - dy));
      const speed = Math.abs(dy) / Math.max(1, Date.now() - startT.current);
      let wantMin;
      if (Math.abs(dy) <= 4) wantMin = !minimized; // tap
      else if (Math.abs(dy) > SWIPE_PX && speed >= FLICK_PX_PER_MS) wantMin = dy > 0;
      else wantMin = endH < (min + max) / 2;
      setDragH(null);
      if (wantMin !== minimized) onMinimizedChange?.(wantMin);
      return;
    }
    if (minimized) {
      if (dy <= SWIPE_PX) onMinimizedChange?.(false);
    } else if (dy < -SWIPE_PX) onExpandedChange(true);
    else if (dy > SWIPE_PX) {
      if (expanded) onExpandedChange(false);
      else onMinimizedChange?.(true);
    } else onExpandedChange(!expanded);
  };
  const onPointerDown = (e) => {
    beginDrag(e.clientY);
    // A mouse drag leaves the grip within a few pixels, and without capture
    // the release lands on the map, so the swipe never registered. Touch
    // captures implicitly; this makes the mouse behave the same.
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer already gone */
    }
  };
  const onPointerCancel = () => {
    startY.current = null;
    setDragH(null);
  };
  const onPointerMove = (e) => moveDrag(e.clientY);
  const onPointerUp = (e) => endDrag(e.clientY);

  // Pulling down on the list while it is scrolled to the top drags the whole
  // sheet down, like a phone's own sheets, so the small grip is not the only
  // place to grab. Scrolling the list up and down works as before.
  const scrollRef = useRef(null);
  const pull = useRef(null); // { y0, started, y }
  const onListTouchStart = (e) => {
    pull.current = (scrollRef.current?.scrollTop ?? 0) <= 0 ? { y0: e.touches[0].clientY, started: false, y: e.touches[0].clientY } : null;
  };
  const onListTouchMove = (e) => {
    const p = pull.current;
    if (!p) return;
    const y = e.touches[0].clientY;
    p.y = y;
    if (!p.started) {
      if (y - p.y0 < -4) pull.current = null; // scrolling the list up: leave it be
      else if (y - p.y0 > 10) {
        p.started = true;
        beginDrag(p.y0);
      }
    }
    if (p.started) moveDrag(y);
  };
  const onListTouchEnd = () => {
    const p = pull.current;
    pull.current = null;
    if (p?.started) endDrag(p.y);
  };
  const toggle = () => {
    if (moodFirst) onMinimizedChange?.(!minimized);
    else if (minimized) onMinimizedChange?.(false);
    else onExpandedChange(!expanded);
  };

  const status = updating ? (
    <span className="mpp-pill" role="status">
      <span className="mpp-pill-dot" /> Updating…
    </span>
  ) : slow && picks ? (
    <span className="mpp-pill mpp-pill-slow" role="status">
      Offline · showing your last picks
    </span>
  ) : null;

  const unit = distanceUnitLabel(units);
  const atMax = distanceMiles != null && distanceMiles >= DISTANCE_OPTIONS_MI[DISTANCE_OPTIONS_MI.length - 1];
  const near = beyond?.places?.[0];
  // Nothing / not much inside the radius: say how far the nearest place
  // really is and offer the one tap that reaches it.
  const emptyText = atMax
    ? `Nothing to pick within ${distanceMiles} ${unit}.`
    : `Nothing within ${distanceMiles} ${unit}.${near ? ` Nearest: ${near.name} (${formatDistance(near.distanceMeters, units)}).` : ''}`;
  const beyondNote =
    beyond && (beyond.places.length > 0 || beyond.widenTo) ? (
      <div className="mpp-beyond">
        {picks?.length > 0 && near && (
          <p className="mpp-empty">
            Only {picks.length} within {distanceMiles} {unit}. Nearest beyond: {near.name} ({formatDistance(near.distanceMeters, units)}).
          </p>
        )}
        {beyond.places.length > 1 && (
          <ul className="mpp-beyond-list">
            {beyond.places.map((p) => (
              <li key={`${p.region}/${p.id}`}>
                {p.name} <span>{formatDistance(p.distanceMeters, units)}</span>
              </li>
            ))}
          </ul>
        )}
        {beyond.widenTo != null && onWiden && (
          <button type="button" className="btn btn-primary btn-sm mpp-widen" onClick={() => onWiden(beyond.widenTo)}>
            Widen to {beyond.widenTo} {unit}
          </button>
        )}
      </div>
    ) : null;

  let body;
  if (state === 'locked') {
    // The Landmarks tab is where first ratings happen (the quick-rate button
    // on every row), so the lock state hands off straight there.
    body = (
      <div className="mpp-empty-wrap">
        <p className="mpp-empty">{ratePlacesText(ratingsCount)} and Mapr will start picking for you.</p>
        <button type="button" className="btn btn-primary btn-block mpp-rate-cta" onClick={() => navigate('/landmarks')}>
          Rate places
        </button>
      </div>
    );
  } else if (state === 'no-location') {
    body = <p className="mpp-empty">Turn on location to see picks near you.</p>;
  } else if (!picks && slow) {
    body = <p className="mpp-empty">You're offline. Picks will show once you're back online.</p>;
  } else if (!picks) {
    body = (
      <ul className="mpp-rows" aria-label="Loading picks">
        {Array.from({ length: expanded && !moodFirst ? PICKS_SHOWN : SHEET_PICKS }, (_, i) => (
          <li key={i} className="mpp-row mpp-skeleton" aria-hidden="true">
            <span className="mpp-row-img" />
            <span className="mpp-skeleton-line" />
          </li>
        ))}
      </ul>
    );
  } else if (!picks.length) {
    body = (
      <div className="mpp-empty-wrap">
        <p className="mpp-empty">{emptyText}</p>
        {beyondNote}
      </div>
    );
  } else if (!queue.length) {
    body = <p className="mpp-empty">That's all the picks for now.</p>;
  } else if (expanded && !moodFirst) {
    body = (
      <div className="mpp-list">
        {queue.slice(0, PICKS_SHOWN).map((p) => (
          <PickCard key={`${p.region}/${p.id}`} pick={p} showChainLabel={showChainLabels} voteSlot={voteSlot(p)} />
        ))}
      </div>
    );
  } else {
    body = (
      <ul className="mpp-rows">
        {queue.slice(0, SHEET_PICKS).map((p) => (
          <PickRow
            key={`${p.region}/${p.id}`}
            pick={p}
            voteSlot={voteSlot(p)}
            action={
              moodFirst ? (
                <DirectionsButton name={p.name} lat={p.lat} lng={p.lng} className="btn btn-ghost btn-sm">
                  Directions
                </DirectionsButton>
              ) : null
            }
          />
        ))}
      </ul>
    );
  }

  // Inside the swipeable grip (default layout), so its pointer and key events
  // must not reach it: tapping refresh must not also expand or collapse.
  const refreshButton =
    onRefresh && state === 'ready' ? (
      <button
        type="button"
        className={`mpp-refresh ${refreshing ? 'spinning' : ''}`}
        aria-label="Show different places"
        title="Show different places"
        disabled={refreshing}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={onRefresh}
      >
        <span aria-hidden="true">{'\u21BB'}</span>
      </button>
    ) : null;

  return (
    <section
      ref={sheetRef}
      className={`mpp-sheet ${expanded && !minimized ? 'expanded' : ''} ${minimized && !dragging ? 'minimized' : ''} ${moodFirst ? 'mpp-sheet-mood' : ''} ${dragging ? 'dragging' : ''}`}
      style={dragging ? { height: `${dragH}px` } : undefined}
      aria-label="Picked for you right now"
    >
      <div
        className="mpp-sheet-grip"
        role="button"
        tabIndex={0}
        aria-expanded={expanded && !minimized}
        aria-label={minimized ? 'Show picks' : expanded ? 'Collapse picks' : 'Show all picks'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span className="mpp-handle" />
        {moodFirst ? (
          minimized && !dragging && <h2 className="mpp-sheet-title mpp-sheet-title-min">Picked for you right now</h2>
        ) : (
          <div className={`mpp-sheet-head ${refreshButton ? 'has-refresh' : ''}`}>
            <h2 className="mpp-sheet-title">Picked for you right now</h2>
            {refreshButton}
            {status}
          </div>
        )}
      </div>
      {/* Outside the swipeable grip, so tapping it doesn't also trigger a
          swipe toggle. Visible collapsed too -- the distance filter itself
          only shows once expanded, and without this a traveler has no way
          to tell (or change) how far "right now" is actually searching,
          easy to confuse with the map's own unrelated zoom radius control. */}
      {!moodFirst && !minimized && !expanded && state === 'ready' && distanceMiles != null && (
        <button type="button" className="mpp-pill mpp-pill-distance" onClick={() => onExpandedChange(true)}>
          Within {distanceMiles} {distanceUnitLabel(units)}
        </button>
      )}
      <div
        className="mpp-sheet-scroll"
        ref={scrollRef}
        onTouchStart={onListTouchStart}
        onTouchMove={onListTouchMove}
        onTouchEnd={onListTouchEnd}
        onTouchCancel={onListTouchEnd}
      >
        {moodFirst ? (
          <>
            {state === 'ready' && moodSlot}
            <section className="mpp-section mpp-callout mpp-top3">
              <div className="mpp-top3-head">
                <h3 className="mpp-section-title">Picked for you right now</h3>
                {refreshButton}
                {status ||
                  (state === 'ready' && distanceMiles != null && (
                    <button type="button" className="mpp-pill mpp-pill-distance" onClick={() => onExpandedChange(!expanded)}>
                      Within {distanceMiles} {distanceUnitLabel(units)}
                    </button>
                  ))}
              </div>
              {expanded && state === 'ready' && toolbar}
              {body}
              {state === 'ready' && picks?.length > 0 && beyondNote}
            </section>
            {expanded && state === 'ready' && children}
          </>
        ) : (
          <>
            {expanded && state === 'ready' && toolbar}
            {body}
            {state === 'ready' && picks?.length > 0 && beyondNote}
            {expanded && state === 'ready' && children}
          </>
        )}
      </div>
    </section>
  );
}
