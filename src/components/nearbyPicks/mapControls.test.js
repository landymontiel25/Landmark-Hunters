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

  // Same probe: at half the screen the open sheet covered the filter button
  // on 390x664 (Safari's visible area) and whenever a banner was up.
  it('caps the open sheet below the left button column', () => {
    const at = css.indexOf('.map-fullscreen.has-picks {');
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toMatch(/--mpp-max:.*var\(--header-h\).*184px.*var\(--nav-h\)/);
    const sheet = css.slice(css.indexOf('.map-picks .mpp-sheet {'), css.indexOf('}', css.indexOf('.map-picks .mpp-sheet {')));
    expect(sheet).toMatch(/height:\s*min\(var\(--mpp-h, 232px\), var\(--mpp-max/);
    const mood = css.slice(css.indexOf('.map-picks .mpp-sheet.mpp-sheet-mood.expanded {'));
    expect(mood.slice(0, mood.indexOf('}'))).toMatch(/min\(var\(--mpp-h\), var\(--mpp-max/);
  });
});
