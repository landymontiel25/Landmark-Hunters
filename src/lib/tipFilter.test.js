import { describe, it, expect } from 'vitest';
import { filterTipText } from './tipFilter.js';

describe('tip word filter', () => {
  it('passes ordinary tips, including words that contain a short slur', () => {
    for (const t of ['Go early, the line wraps the block by noon.', 'The raccoon exhibit is great for kids.', 'Spicy noodles at the stand by the gate.', 'Cocktail bar upstairs, quiet on Mondays.', 'Grapes at the market stall, Pakistan Day festival in May.', 'Grab a scone at Dickinson Square.']) {
      expect(filterTipText(t)).toEqual({ flagged: false, reasons: [] });
    }
  });
  it('holds profanity, even with look-alike characters', () => {
    expect(filterTipText('this place is sh1t').reasons).toContain('profanity');
    expect(filterTipText('F U C K this line').flagged).toBe(false); // spaced-out profanity is not a slur; left to reports
    expect(filterTipText('fuck this line').reasons).toContain('profanity');
  });
  it('holds slurs with spacing or dots', () => {
    expect(filterTipText('f.a.g.g.o.t').reasons).toContain('slur');
    expect(filterTipText('the staff are r3tard').reasons).toContain('slur');
    expect(filterTipText('f a g g o t').reasons).toContain('slur');
  });
  it('leaves words that merely contain a listed word, and places like Dick\'s or a Nazi-era exhibit', () => {
    for (const t of ['Kids snigger at the statue.', 'Built 1776-1783, 1812 wing added later.', 'Open 9-5, closed 12/24 and 12/25 2026.', 'Kids were sniggering at the statue.', "Dick's Sporting Goods is upstairs.", 'The Nazi-era exhibit is upstairs.', 'Graduated magna cum laude here.']) expect(filterTipText(t).flagged).toBe(false);
  });
  it('never joins real words across a sentence into a slur', () => {
    expect(filterTipText('You will get wet. Back entrance is drier.').flagged).toBe(false);
    expect(filterTipText('Cool rag. Head upstairs for views.').flagged).toBe(false);
  });
  it('a mark at the end of a word, or a curly apostrophe, never hides it', () => {
    for (const t of ['This place is shit!', 'I will kill you!', 'go die!!', 'what a retard!', 'kys!', 'i\u2019ll hurt you']) expect(filterTipText(t).flagged).toBe(true);
    expect(filterTipText('b!tch at the door').reasons).toContain('profanity');
  });
  it('holds threats, spam phrases and contact details', () => {
    expect(filterTipText('go die in the river').reasons).toContain('threat-or-spam');
    expect(filterTipText('DM me for a promo code').reasons).toContain('threat-or-spam');
    expect(filterTipText('Call 215 555 0100 for tickets').reasons).toContain('contact');
    expect(filterTipText('write me at a@b.com').reasons).toContain('contact');
    expect(filterTipText('Text (215) 555-0100 now').reasons).toContain('contact');
    expect(filterTipText('WhatsApp +44 20 7946 0958').reasons).toContain('contact');
  });
});
