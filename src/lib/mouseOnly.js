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
