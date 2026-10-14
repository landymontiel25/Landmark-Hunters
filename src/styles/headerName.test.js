import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Found by the app simulation (probe overflow-sweep): a long display name
// in the header's profile pill made every screen 420px wide on a 390px
// phone. jsdom has no layout, so this checks the CSS rules that cut it;
// `node scripts/app-sim/probe.mjs overflow-sweep` checks it in a browser.
const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
const rule = (selector) => {
  const at = css.indexOf(`${selector} {`);
  return at === -1 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('header profile pill', () => {
  it('has a width cap', () => {
    expect(rule('.profile-menu-trigger')).toMatch(/max-width:\s*\d/);
  });

  it('cuts a long name with an ellipsis', () => {
    const r = rule('.profile-menu-trigger .score-chip-pts');
    expect(r).toMatch(/overflow:\s*hidden/);
    expect(r).toMatch(/text-overflow:\s*ellipsis/);
    expect(r).toMatch(/min-width:\s*0/);
  });
});
