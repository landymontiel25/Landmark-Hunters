import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Found by the app simulation: with Picked for you open (half the screen)
// the Map's radius menu rose into the search / + / filter buttons on the
// left and covered the filter button. jsdom has no layout, so this checks
// the rule that moves it; `node scripts/app-sim/probe.mjs map-controls`
// checks the boxes in a browser at 390x844 and 390x664.
const css = readFileSync(new URL('./nearbyPicks.css', import.meta.url), 'utf8');

describe('map controls with the picks sheet open', () => {
  it('moves the radius menu to the right, next to the locate button', () => {
    const at = css.indexOf('.map-fullscreen.has-picks .map-fab-bar {');
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toMatch(/left:\s*auto/);
    expect(rule).toMatch(/right:\s*68px/);
  });
});
