// While a pin's card is open on the Map, only the map and the card show
// (owner, 2026-11-25: the card was cut off behind the header and jammed
// against the picks sheet). One class on <html> hides the header, the
// "where you are" pill, the search bar, the top banners (offline included),
// the picks sheet with its category chips and the tab bar; the map's own +
// and locate buttons stay. CSS: "Map card focus" in new-ui-live.css.
export const MAP_CARD_OPEN_CLASS = 'map-card-open';

export function setMapCardOpen(open, root = typeof document === 'undefined' ? null : document.documentElement) {
  root?.classList.toggle(MAP_CARD_OPEN_CLASS, !!open);
}

// While the card is open the map's + and locate buttons move up into the
// top corner, under the notch (CSS: MAP_CONTROLS_TOP below the safe area,
// 48 pt each, 6 pt apart), and the card stays below them: it's nearly full
// width, so it can't sit beside them.
export const MAP_CONTROLS_TOP = 12;
export const MAP_CONTROLS_HEIGHT = 48 + 6 + 48;
const GAP = 12;

// The device's safe areas (notch / Dynamic Island, home indicator), read once.
let insets = null;
export function safeAreaInsets() {
  if (insets) return insets;
  if (typeof document === 'undefined' || !document.body) return { top: 0, bottom: 0 };
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  insets = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  probe.remove();
  return insets;
}

// Where Leaflet may pan an open card: below the two map buttons, above the
// home indicator, 16 pt from the sides.
export function cardPanPadding({ top, bottom } = safeAreaInsets()) {
  return {
    topLeft: [16, top + MAP_CONTROLS_TOP + MAP_CONTROLS_HEIGHT + GAP],
    bottomRight: [16, bottom + 16],
  };
}
