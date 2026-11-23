// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isTap, touchTarget, TAP_SLOP_PX } from './mapCardGestures';

describe('map card gestures', () => {
  it('a quick touch that barely moved is a tap; a drag or a long press is not', () => {
    const s = { x: 100, y: 100, t: 0 };
    expect(isTap(s, { x: 104, y: 103, t: 120 })).toBe(true);
    expect(isTap(s, { x: 100 + TAP_SLOP_PX, y: 100, t: 120 })).toBe(false);
    expect(isTap(s, { x: 140, y: 100, t: 120 })).toBe(false);
    expect(isTap(s, { x: 100, y: 100, t: 900 })).toBe(false);
  });
  it('knows the card, a pin and empty map apart', () => {
    document.body.innerHTML = `
      <div class="leaflet-container">
        <div class="leaflet-popup"><div class="map-popup"><h4 id="card">Name</h4></div></div>
        <div class="leaflet-marker-icon"><div id="pin" class="map-pin"></div></div>
        <div class="leaflet-control"><button id="ctl"></button></div>
        <div class="leaflet-tile-pane"><img id="tile" /></div>
      </div>`;
    expect(touchTarget(document.getElementById('card'))).toBe('card');
    expect(touchTarget(document.getElementById('pin'))).toBe('pin');
    expect(touchTarget(document.getElementById('ctl'))).toBe('pin');
    expect(touchTarget(document.getElementById('tile'))).toBe('map');
  });
});
