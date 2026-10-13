// The word filter for tips (App Store guideline 1.2: a way to filter
// objectionable content). A flagged tip is not refused: api/post-tip.js
// saves it as `held`, hidden from everyone but its author until the owner
// reviews it on the admin dashboard's Content page. So the list can lean
// strict; a false hit costs a review, not a lost tip.
//
// The text is normalized first (lowercase, common look-alike digits and
// symbols swapped back, accents dropped), then checked word by word and,
// for the slurs, with spaces and punctuation squeezed out too ("f.a.g").

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };

export function normalizeForFilter(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[013457@$!|8]/g, (c) => LEET[c] || c);
}

// Slurs and hate terms. The long, unmistakable ones are also checked inside
// squeezed text, so spacing and dots don't get around them; shorter ones
// are whole words only, so "raccoon", "spicy" or "Pakistan" never trip.
const SLURS_SQUEEZED = ['nigger', 'nigga', 'faggot', 'sandnigger', 'shemale', 'towelhead', 'raghead', 'wetback', 'tranny'];
const SLURS_WORDS = ['retard', 'retards', 'kike', 'kikes', 'chink', 'chinks', 'spic', 'spics', 'beaner', 'beaners', 'gook', 'gooks', 'coon', 'coons', 'dyke', 'dykes', 'paki', 'pakis'];
// Whole words only.
const WORDS = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'shitty', 'bullshit', 'bitch', 'bitches', 'cunt', 'cock', 'dick',
  'dickhead', 'pussy', 'whore', 'slut', 'bastard', 'asshole', 'twat', 'wanker', 'porn', 'porno', 'nude', 'nudes',
  'blowjob', 'handjob', 'rape', 'rapist', 'nazi', 'kys', 'cum', 'jizz', 'fag', 'fags', 'escort', 'escorts', 'onlyfans',
];
// Threats, harassment and spam, as phrases on the normalized text.
const PHRASES = [
  /\bkill (?:yo)?u(?:rself)?\b/, /\bkill your ?self\b/, /\bgo die\b/, /\bi(?:'| wi)ll (?:find|hurt|kill) you\b/,
  /\bshoot (?:up|you)\b/, /\bbomb (?:this|the)\b/, /\bdm me\b/, /\bpromo code\b/, /\bcoupon code\b/,
  /\bfollow me on\b/, /\bcheck out my\b/, /\bcash ?app\b/, /\bvenmo\b/, /\bcrypto\b/, /\bbitcoin\b/,
];
// A phone number or an email address in a tip reads as spam or doxxing.
const PHONE_RE = /(?:\+?\d[\s().-]?){10,}/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

const WORD_SET = new Set(WORDS);
const SLUR_WORD_SET = new Set(SLURS_WORDS);

// { flagged, reasons: ['slur' | 'profanity' | 'threat-or-spam' | 'contact'] }
export function filterTipText(text) {
  const raw = String(text || '');
  const norm = normalizeForFilter(raw);
  // Squeezed within each space-separated chunk ("f.a.g.g.o.t"), and across
  // runs of single letters ("f a g g o t"), never across real words, so
  // "wet. Back" or "rag. Head" stay apart.
  const chunks = norm.split(/\s+/).map((c) => c.replace(/[^a-z]/g, '')).filter(Boolean);
  const squeezed = [...chunks];
  for (let i = 0; i < chunks.length; ) {
    let j = i;
    while (j < chunks.length && chunks[j].length === 1) j++;
    if (j - i >= 3) squeezed.push(chunks.slice(i, j).join(''));
    i = j > i ? j : i + 1;
  }
  const reasons = new Set();
  const words = norm.split(/[^a-z]+/).filter(Boolean);
  if (squeezed.some((c) => SLURS_SQUEEZED.some((s) => c.includes(s))) || words.some((w) => SLUR_WORD_SET.has(w))) reasons.add('slur');
  if (words.some((w) => WORD_SET.has(w))) reasons.add('profanity');
  if (PHRASES.some((re) => re.test(norm))) reasons.add('threat-or-spam');
  if (PHONE_RE.test(raw) || EMAIL_RE.test(raw)) reasons.add('contact');
  return { flagged: reasons.size > 0, reasons: [...reasons] };
}
