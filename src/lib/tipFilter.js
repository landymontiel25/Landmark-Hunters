// The word filter for tips (App Store guideline 1.2: a way to filter
// objectionable content). A flagged tip is not refused: api/post-tip.js
// saves it as `held`, hidden from everyone but its author until the owner
// reviews it on the admin dashboard's Content page. So the list can lean
// strict; a false hit costs a review, not a lost tip.
//
// The text is normalized first (lowercase, common look-alike digits and
// symbols swapped back, accents dropped), then checked word by word and,
// for the slurs, with spaces and punctuation squeezed out too ("f.a.g").

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i' };

// Every look-alike swapped, wherever it sits ("n.1.g", "nigg@"). Used for
// the slur checks only: "shit!" must keep its "!" for the word checks.
const fullLeet = (norm) => norm.replace(/[01345679@$!|8]/g, (c) => LEET[c] || c);

export function normalizeForFilter(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Curly quotes (an iPhone's default) read as straight ones.
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    // A look-alike counts as a letter only before another letter or
    // look-alike ("sh1t", "b!tch"), so "shit!" or "you!" keep their ending.
    .replace(/[01345679@$!|8]+(?=[a-z])/g, (run) => run.replace(/./g, (c) => LEET[c] || c));
}

// Slurs and hate terms. The long, unmistakable ones are also checked inside
// squeezed text, so spacing and dots don't get around them; shorter ones
// are whole words only, so "raccoon", "spicy" or "Pakistan" never trip.
const SLURS_SQUEEZED = ['nigger', 'nigga', 'faggot', 'shemale', 'towelhead', 'raghead', 'wetback', 'tranny'];
const SLURS_WORDS = ['retard', 'retards', 'kike', 'kikes', 'chink', 'chinks', 'spic', 'spics', 'beaner', 'beaners', 'gook', 'gooks', 'coon', 'coons', 'dyke', 'dykes', 'paki', 'pakis'];
// Whole words only.
const WORDS = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'shitty', 'bullshit', 'bitch', 'bitches', 'cunt', 'cock',
  'dickhead', 'pussy', 'whore', 'slut', 'bastard', 'asshole', 'twat', 'wanker', 'porn', 'porno', 'nude', 'nudes',
  'blowjob', 'handjob', 'rape', 'rapist', 'kys', 'jizz', 'fag', 'fags', 'escort', 'escorts', 'onlyfans',
];
// Threats, harassment and spam, as phrases on the normalized text.
const PHRASES = [
  /\bkill (?:yo)?u(?:rself)?\b/, /\bkill your ?self\b/, /\bgo die\b/, /\bi(?:'| wi)ll (?:hurt|kill) you\b/,
  /\bshoot (?:up|you)\b/, /\bbomb (?:this|the)\b/, /\bdm me\b/, /\bpromo code\b/, /\bcoupon code\b/,
  /\bfollow me on\b/, /\bcheck out my\b/, /\bcash ?app\b/, /\bvenmo\b/, /\bcrypto\b/, /\bbitcoin\b/,
];
// A phone number or an email address in a tip reads as spam or doxxing.
// A US-style number (215 555 0100, (215) 555-0100, +1 215.555.0100) or
// an international one written with a +. Years and ranges (1776-1783) aren't.
const PHONE_RE = /(?:^|[^\d])(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)|\+\d[\d\s.-]{8,}\d/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

const WORD_SET = new Set(WORDS);
const SLUR_WORD_SET = new Set(SLURS_WORDS);
const SLUR_CHUNK_RE = new RegExp(`^(?:sand)?(?:${SLURS_SQUEEZED.join('|')})(?:s|z|es|as|az)?$`);

// { flagged, reasons: ['slur' | 'profanity' | 'threat-or-spam' | 'contact'] }
export function filterTipText(text) {
  const raw = String(text || '');
  const norm = normalizeForFilter(raw);
  // Squeezed within each space-separated chunk ("f.a.g.g.o.t"), and across
  // runs of single letters ("f a g g o t"), never across real words, so
  // "wet. Back" or "rag. Head" stay apart.
  // Both readings of each chunk: look-alikes swapped only before a letter
  // ("shit!" stays "shit"), and every look-alike swapped ("n.1.g.g.e.r").
  const chunkSets = [norm, fullLeet(norm)].map((n) => n.split(/\s+/).map((c) => c.replace(/[^a-z]/g, '')).filter(Boolean));
  const chunks = chunkSets.flat();
  // Runs of single letters ("a f a g g o t"): any slur inside counts, since
  // no real word is split that way.
  const spaced = [];
  for (const set of chunkSets) {
    for (let i = 0; i < set.length; ) {
      let j = i;
      while (j < set.length && set[j].length === 1) j++;
      if (j - i >= 3) spaced.push(set.slice(i, j).join(''));
      i = j > i ? j : i + 1;
    }
  }
  const reasons = new Set();
  const words = norm.split(/[^a-z]+/).filter(Boolean);
  // A squeezed chunk that is the slur (maybe plural), never a word that
  // merely has it inside ("snigger", "sniggering").
  if (
    chunks.some((c) => SLUR_CHUNK_RE.test(c)) ||
    spaced.some((run) => SLURS_SQUEEZED.some((s) => run.includes(s))) ||
    words.some((w) => SLUR_WORD_SET.has(w))
  ) {
    reasons.add('slur');
  }
  if (words.some((w) => WORD_SET.has(w))) reasons.add('profanity');
  if (PHRASES.some((re) => re.test(norm))) reasons.add('threat-or-spam');
  if (PHONE_RE.test(raw) || EMAIL_RE.test(raw)) reasons.add('contact');
  return { flagged: reasons.size > 0, reasons: [...reasons] };
}
