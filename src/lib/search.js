// Shared multi-word "smart enough" search matcher, used everywhere the app
// searches its own data (landmarks, regions/cities, interests) -- NOT
// LocationAutocomplete, which searches the live world via Nominatim and
// already does its own fuzzy matching server-side.
//
// A plain single-substring check (`haystack.includes(term)`) fails on a
// query like "Miami F1": no single field contains that exact phrase, even
// though the landmark ("Miami International Autodrome") obviously *is* the
// Miami F1 track once you look at its name, city and facts together. This
// instead requires every WORD in the query to appear somewhere in the
// haystack, in any order, scattered across whichever fields the caller
// joined into it -- an AND match per word rather than one exact phrase
// match, so a query that names several things about the result (a city + a
// nickname, a category + a landmark name, etc.) finds it without needing
// an AI round trip on every keystroke.
//
// It also forgives typos: a query word of 4+ letters also matches any word
// in the haystack (or the start of one, for a half-typed word) within 1
// edit -- 2 for 7+ letters -- counting a swapped pair of letters as one
// edit. "eifel towr" finds the Eiffel Tower. Accents are ignored ("cafe"
// finds "Café"). Shorter words ("f1", "nyc") still need an exact match.

const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

// Optimal string alignment distance (Levenshtein + adjacent transpositions),
// giving up early once it can't come in at or under `max`.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

// Spelling by sound: "filadelfia" and "philadelphia", "coloseum" and
// "colosseum" come out the same.
const sound = (w) =>
  w
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1');

function fuzzyWordMatch(word, tokens) {
  const max = word.length >= 7 ? 2 : 1;
  const sw = sound(word);
  return tokens.some((t) => {
    if (editDistance(word, t, max) <= max) return true;
    // A half-typed word: compare against the start of the longer one.
    if (t.length > word.length && editDistance(word, t.slice(0, word.length), max) <= max) return true;
    const st = sound(t);
    // The sound form can be much shorter than the word ("zzzzqqqq" -> "zq"),
    // so the allowance follows ITS length, or gibberish matches everything.
    const smax = Math.min(max, sw.length >= 7 ? 2 : sw.length >= 4 ? 1 : 0);
    return editDistance(sw, st, smax) <= smax || (st.length > sw.length && editDistance(sw, st.slice(0, sw.length), smax) <= smax);
  });
}

// How one query word matches a folded text: 2 = as typed, 1 = with a typo, 0 = not at all.
function wordMatch(w, hay, tokensRef) {
  if (hay.includes(w)) return 2;
  if (w.length < 4) return 0;
  tokensRef.t = tokensRef.t || hay.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  return fuzzyWordMatch(w, tokensRef.t) ? 1 : 0;
}

const queryWords = (query) => fold(query).trim().split(/\s+/).filter(Boolean);

export function matchesSearch(haystack, query) {
  const words = queryWords(query);
  if (!words.length) return true;
  const hay = fold(haystack);
  const ref = {};
  return words.every((w) => wordMatch(w, hay, ref) > 0);
}

/**
 * Relevance for ranking results: 0 when it doesn't match at all (same rule
 * as matchesSearch across name + details), higher is better. Words found in
 * the name count for more than words found only in the description, and
 * exact spellings more than typo matches -- so "liberty bell" puts Liberty
 * Bell Center first rather than whatever mentions a bell somewhere.
 */
export function searchScore(name, details, query) {
  const words = queryWords(query);
  if (!words.length) return 1;
  const n = fold(name);
  const d = fold(details);
  const nRef = {};
  const dRef = {};
  let score = 0;
  for (const w of words) {
    const inName = wordMatch(w, n, nRef);
    if (inName) {
      score += inName === 2 ? 4 : 3;
      continue;
    }
    const inDetails = wordMatch(w, d, dRef);
    if (!inDetails) return 0;
    score += inDetails === 2 ? 2 : 1;
  }
  // A name that starts with what was typed is the likeliest target.
  if (n.startsWith(words[0])) score += 1;
  return score;
}
