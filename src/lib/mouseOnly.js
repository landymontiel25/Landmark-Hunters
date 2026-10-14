// Wraps a hover handler so only a real mouse runs it.
//
// A tap on a phone fires pointerenter/mouseenter just before its click. An
// element that opens on hover and toggles on click (a name on the
// leaderboard, a badge tile) opened on the enter and closed again on the
// click, so the tap did nothing. Found by the app simulation
// (docs/app-sim-results.md). Use with onPointerEnter / onPointerLeave.
export const mouseOnly = (fn) => (e) => {
  if (e?.pointerType === 'mouse') fn(e);
};

// On a desktop the pointer arrives (hover opens the card) a moment before
// the click on the same spot, and the click then toggled the card shut.
// A click this soon after the hover that opened it keeps it open.
export const HOVER_CLICK_GRACE_MS = 600;
