import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Found by the app simulation (probe long-text): a comment with a long
// unbroken word (a pasted link) made the landmark page 1,819px wide on a
// 390px phone. jsdom has no layout, so this checks the rule;
// `node scripts/app-sim/probe.mjs long-text` checks it in a browser.
const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

describe('review comments', () => {
  it('break a long word instead of widening the page', () => {
    const at = css.indexOf('.review-comment {');
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf('}', at))).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
