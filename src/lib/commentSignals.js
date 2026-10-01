import { COMMENT_LEXICON } from '../data/commentLexicon.js';
import {
  COMMENT_CAP_PER_TAG,
  COMMENT_COMPLAINT_DELTA,
  COMMENT_MAX_TAGS,
  COMMENT_NEGATED_PRAISE_FACTOR,
  COMMENT_PRAISE_DELTA,
} from './maprConstants.js';

// Reads a rating's comment and turns it into per-tag score deltas, using the
// word list in src/data/commentLexicon.js. Pure and deterministic: the same
// text always gives the same answer, and no model is called.
//
//  - The longest phrase wins where phrases overlap ("not worth the price"
//    beats "worth"), and each lexicon entry counts once per comment.
//  - Negation: a negator (not, no, never, n't words, without...) up to 3
//    words before the phrase, with no punctuation or "but" between, flips it.
//    A negated complaint ("not loud") does nothing; a negated praise ("not
//    good food") counts as a weaker complaint.
//  - Capped: no tag moves more than COMMENT_CAP_PER_TAG, and at most
//    COMMENT_MAX_TAGS tags move (the biggest ones), however long the comment.

const NEGATORS = new Set([
  'not', 'no', 'never', 'without', 'hardly', 'barely', 'cant', "can't", 'cannot',
  'isnt', "isn't", 'wasnt', "wasn't", 'arent', "aren't", 'werent', "weren't",
  'dont', "don't", 'didnt', "didn't", 'doesnt', "doesn't", 'wont', "won't",
  'wouldnt', "wouldn't", 'couldnt', "couldn't", 'aint', "ain't", 'hasnt', "hasn't", 'havent', "haven't",
]);
const BREAKERS = new Set(['.', ',', ';', '!', '?', ':', '(', ')', 'but', 'although', 'though', 'however']);
const NEGATION_WINDOW = 3;

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .match(/[a-z0-9']+|[.,;!?:()]/g) || [];
}

let compiled = null;
function compile() {
  if (compiled) return compiled;
  compiled = COMMENT_LEXICON.flatMap((entry) =>
    entry.terms.map((term) => ({ entry, words: tokenize(term) })).filter((t) => t.words.length)
  ).sort((a, b) => b.words.length - a.words.length);
  return compiled;
}

function negatedAt(tokens, start) {
  for (let i = start - 1; i >= 0 && i >= start - NEGATION_WINDOW; i--) {
    if (BREAKERS.has(tokens[i])) return false;
    if (NEGATORS.has(tokens[i]) || (tokens[i].endsWith("n't") && tokens[i].length > 3)) return true;
  }
  return false;
}

// The matched lexicon entries in a comment: [{ id, tags, valence, negated }].
export function commentHits(text) {
  const tokens = tokenize(text);
  if (!tokens.length) return [];
  const used = new Array(tokens.length).fill(false);
  const seen = new Set();
  const hits = [];
  for (const { entry, words } of compile()) {
    if (seen.has(entry.id)) continue;
    for (let i = 0; i + words.length <= tokens.length; i++) {
      if (used.slice(i, i + words.length).some(Boolean)) continue;
      if (!words.every((w, k) => tokens[i + k] === w)) continue;
      for (let k = 0; k < words.length; k++) used[i + k] = true;
      seen.add(entry.id);
      hits.push({ id: entry.id, tags: entry.tags, valence: entry.valence, negated: negatedAt(tokens, i), at: i });
      break;
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}

const round2 = (n) => Math.round(n * 100) / 100;

// { tag: points } for a comment on a place with `placeTags`. 'self' entries
// apply to the place's own tags. Empty object when the text says nothing.
export function commentTagDeltas(text, placeTags = []) {
  const sums = {};
  for (const h of commentHits(text)) {
    let delta;
    if (h.valence > 0) delta = h.negated ? COMMENT_COMPLAINT_DELTA * COMMENT_NEGATED_PRAISE_FACTOR : COMMENT_PRAISE_DELTA;
    else delta = h.negated ? 0 : COMMENT_COMPLAINT_DELTA;
    if (!delta) continue;
    const tags = h.tags.includes('self') ? placeTags || [] : h.tags;
    for (const tag of new Set(tags)) sums[tag] = (sums[tag] || 0) + delta;
  }
  const capped = Object.entries(sums)
    .map(([tag, v]) => [tag, round2(Math.max(-COMMENT_CAP_PER_TAG, Math.min(COMMENT_CAP_PER_TAG, v)))])
    .filter(([, v]) => v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, COMMENT_MAX_TAGS);
  return Object.fromEntries(capped);
}
