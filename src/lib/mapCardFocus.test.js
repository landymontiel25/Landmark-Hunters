// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { setMapCardOpen, MAP_CARD_OPEN_CLASS, cardPanPadding } from './mapCardFocus';

describe('map card focus', () => {
  it('sets and clears the class on the root', () => {
    const root = document.createElement('html');
    setMapCardOpen(true, root);
    expect(root.classList.contains(MAP_CARD_OPEN_CLASS)).toBe(true);
    setMapCardOpen(false, root);
    expect(root.classList.contains(MAP_CARD_OPEN_CLASS)).toBe(false);
  });

  it('hides every overlay the owner listed, and keeps the map controls', () => {
    const css = readFileSync('src/styles/new-ui-live.css', 'utf8');
    const block = css.slice(css.indexOf('/* Map card focus'), css.indexOf("/* The map's own + and locate"));
    for (const sel of ['.app-header', '.where-am-i-row', '.offline-banner', '.bottom-nav', '.map-search-btn.ap-search-pill', '.map-picks', '.map-cat-bar']) {
      expect(block).toContain(`html.map-card-open ${sel}`);
    }
    expect(block).not.toContain('map-locate-btn');
    expect(block).not.toContain('map-add-btn');
  });

  it('keeps the card below the moved map buttons and above the home indicator', () => {
    const { topLeft, bottomRight } = cardPanPadding({ top: 59, bottom: 34 });
    // Buttons: 59 + 12 to 59 + 12 + 102 = 173; the card starts 12 below.
    expect(topLeft).toEqual([16, 185]);
    expect(bottomRight).toEqual([16, 50]);
    const css = readFileSync('src/styles/new-ui-live.css', 'utf8');
    expect(css).toContain('html.map-card-open body[data-apple] .map-fullscreen .map-locate-btn');
  });
});
