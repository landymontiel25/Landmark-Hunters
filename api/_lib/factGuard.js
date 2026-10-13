// The last check on every Mapr chat reply (api/plan-ai.js) before it reaches
// the traveler. The instructions tell the AI never to guess a distance, a
// travel time, opening hours, a price or a star rating; this makes sure of
// it. A claim survives only when something real backs it in THIS reply:
// - distances and travel times must match a route_between (Google Maps)
//   result within rounding;
// - hours, prices and ratings need a live lookup (web search, or the
//   place_hours tool for hours) in this reply.
// Anything else is cut out of the reply, and a distance question that ends
// with no checked number says so plainly instead.

const WORD_NUM = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60,
  'a couple': 2, 'a couple of': 2, couple: 2, 'a few': 3, few: 3, several: 5, half: 0.5, 'a half': 0.5,
};
const NUM = String.raw`(\d+(?:\.\d+)?|${Object.keys(WORD_NUM).sort((a, b) => b.length - a.length).map((w) => w.replace(/[-\s]/g, '[-\\s]')).join('|')})`;
const RANGE = String.raw`${NUM}(?:\s*(?:-|–|to|or)\s*(\d+(?:\.\d+)?))?`;
const DIST_UNIT = String.raw`(mi|miles?|km|kms|kilometers?|kilometres?|blocks?|meters?|metres?|feet|ft)`;
const TIME_UNIT = String.raw`(min|mins|minutes?|hrs?|hours?)`;
const DIST_RE = new RegExp(String.raw`(?:~\s*)?(?<![\d.,])\b${RANGE}[-\s]*${DIST_UNIT}\b`, 'gi');
const TIME_RE = new RegExp(String.raw`(?:~\s*)?(?<![\d.,])\b${RANGE}[-\s]*${TIME_UNIT}\b`, 'gi');
const COMPOUND = /(?<![\d.,])\b(\d+)\s*(?:hr|hrs|hours?)\s*(?:and\s*)?(\d+)\s*(?:min|mins|minutes?)\b/gi;
const HALF_HOUR = /\b(half an hour|half-hour|an hour and a half|hour and a half)\b/gi;
// Travel words that make "20 minutes" a travel time (a "90-minute tour" or
// "spend two hours there" is not).
const TRAVEL_CUE = /\b(away|drive|driving|drives|walk|walking|walkable|on foot|by foot|ride|by car|car ride|uber|lyft|taxi|cab|train|subway|metro|bus|bike|biking|transit|commute|from (?:here|you|your|there|the)|to get (?:there|here)|get there|trip|out of your way|down the road|up the road|from)\b/i;
// Vague closeness, which is still a claim about the real distance.
const VAGUE = /\b(a (?:short|quick|little|easy) (?:drive|walk|ride|stroll|hop)|(?:short|quick) (?:drive|walk|ride|stroll) (?:away|from)|walking distance|walkable from|right around the corner|around the corner from|just down the (?:street|road|block)|a stone'?s throw|next door to|steps (?:away|from)|a few (?:blocks|minutes|mins) (?:away|from)|close by|nearby to|right (?:near|by|next to))\b/gi;

const HOURS_RE = /\b(open(?:s|ed)?|close(?:s|d)?|closing|opening|until|till|til)\b[^.!?\n]{0,25}?\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|noon|midnight)|\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|midnight)|\bopen 24(?: hours|\/7)\b|\b(?:is |it'?s |they'?re )?(?:open|closed) (?:right )?now\b/gi;
const PRICE_RE = /(?:\$\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*(?:\.\d{2})?\s?(?:dollars|bucks|usd)\b|\b(?:free admission|admission is free|free entry|no cover)\b)/gi;
const RATING_RE = /\b\d(?:\.\d)?\s?(?:\/\s?5|out of 5|stars?|★)|\brated\s\d(?:\.\d)?\b/gi;

const toNum = (s) => {
  if (s == null) return NaN;
  const k = String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  if (k in WORD_NUM) return WORD_NUM[k];
  const k2 = k.replace(/-/g, ' ');
  if (k2 in WORD_NUM) return WORD_NUM[k2];
  return Number(k);
};

const unitKind = (u) => {
  const x = u.toLowerCase();
  if (/^(mi|miles?)$/.test(x)) return 'mi';
  if (/^(km|kms|kilomet)/.test(x)) return 'km';
  if (/^(meters?|metres?)$/.test(x)) return 'm';
  if (/^(feet|ft)$/.test(x)) return 'ft';
  if (/^blocks?$/.test(x)) return 'block';
  if (/^(hrs?|hours?)$/.test(x)) return 'h';
  return 'min';
};

// Every distance / travel-time claim in the text, with where it sits.
export function travelClaims(text) {
  const s = String(text || '');
  const out = [];
  for (const m of s.matchAll(DIST_RE)) {
    const lo = toNum(m[1]);
    const hi = m[2] != null ? Number(m[2]) : lo;
    if (!Number.isFinite(lo)) continue;
    out.push({ kind: 'distance', unit: unitKind(m[3]), lo, hi, index: m.index, length: m[0].length, text: m[0] });
  }
  const spans = [];
  for (const m of s.matchAll(COMPOUND)) {
    const around = s.slice(Math.max(0, m.index - 40), m.index + m[0].length + 45);
    spans.push([m.index, m.index + m[0].length]);
    if (!TRAVEL_CUE.test(around)) continue;
    const v = Number(m[1]) * 60 + Number(m[2]);
    out.push({ kind: 'time', unit: 'min', lo: v, hi: v, index: m.index, length: m[0].length, text: m[0] });
  }
  for (const m of s.matchAll(HALF_HOUR)) {
    spans.push([m.index, m.index + m[0].length]);
    const around = s.slice(Math.max(0, m.index - 40), m.index + m[0].length + 45);
    if (!TRAVEL_CUE.test(around)) continue;
    const v = /and a half/i.test(m[0]) ? 90 : 30;
    out.push({ kind: 'time', unit: 'min', lo: v, hi: v, index: m.index, length: m[0].length, text: m[0] });
  }
  for (const m of s.matchAll(TIME_RE)) {
    if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const lo = toNum(m[1]);
    const hi = m[2] != null ? Number(m[2]) : lo;
    if (!Number.isFinite(lo)) continue;
    const around = s.slice(Math.max(0, m.index - 40), m.index + m[0].length + 45);
    if (!TRAVEL_CUE.test(around)) continue;
    out.push({ kind: 'time', unit: unitKind(m[3]), lo, hi, index: m.index, length: m[0].length, text: m[0] });
  }
  for (const m of s.matchAll(VAGUE)) out.push({ kind: 'vague', index: m.index, length: m[0].length, text: m[0] });
  return out;
}

const close = (claimed, real, rel, abs) => Math.abs(claimed - real) <= Math.max(abs, real * rel);

// Does a claim match one of this reply's real routes?
export function claimVerified(c, routes = []) {
  const ok = routes.filter((r) => r && !r.error && Number.isFinite(r.miles));
  if (!ok.length) return false;
  if (c.kind === 'vague') return ok.some((r) => r.minutes <= 15 || r.miles <= 1);
  const vals = c.lo === c.hi ? [c.lo] : [c.lo, c.hi, (c.lo + c.hi) / 2];
  return ok.some((r) => {
    if (c.kind === 'distance') {
      const realIn = { mi: r.miles, km: r.km, m: r.km * 1000, ft: r.miles * 5280, block: r.miles * 20 }[c.unit];
      if (c.unit === 'block') return false;
      // A range must contain the real value; a single number must round to it.
      if (c.lo !== c.hi) return realIn >= c.lo * 0.95 && realIn <= c.hi * 1.05;
      return vals.some((v) => close(v, realIn, 0.06, c.unit === 'm' || c.unit === 'ft' ? 50 : 0.2));
    }
    const mins = [r.minutes, r.minutesWithoutTraffic].filter(Number.isFinite);
    const inMin = (v) => (c.unit === 'h' ? v * 60 : v);
    if (c.lo !== c.hi) return mins.some((m) => m >= inMin(c.lo) - 1 && m <= inMin(c.hi) + 1);
    return vals.some((v) => mins.some((m) => close(inMin(v), m, 0.12, 2)));
  });
}

// Lookups this reply actually made.
export function evidenceOf({ routes = [], webSearches = 0, hoursLookups = [] } = {}) {
  return { routes, searched: webSearches > 0, hours: hoursLookups.filter((h) => h && !h.error) };
}

// Clock times as minutes after midnight: "9 PM", "9:30 pm", "noon".
const CLOCK = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?|\b(noon|midnight)\b/gi;
export function clockTimes(text) {
  const out = [];
  for (const m of String(text || '').matchAll(CLOCK)) {
    if (m[4]) out.push(m[4].toLowerCase() === 'noon' ? 720 : 0);
    else out.push(((Number(m[1]) % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + Number(m[2] || 0));
  }
  return out;
}

// An hours claim backed by a place_hours result: its times are ones the
// lookup gave, and "open now" / "closed now" matches it.
function hoursVerified(claim, lookups) {
  const allowed = new Set(lookups.flatMap((h) => clockTimes([h.closesAt, h.opensAt, h.today].filter(Boolean).join(' '))));
  const times = clockTimes(claim);
  if (times.some((t) => !allowed.has(t) && !(t === 0 && allowed.has(1440)))) return false;
  const now = /\b(open|closed)\b(?: right)? now\b/i.exec(claim);
  if (now && !lookups.some((h) => (h.openNow === true) === (now[1].toLowerCase() === 'open'))) return false;
  if (/open 24/i.test(claim) && !lookups.some((h) => /24 hours/i.test(h.today || ''))) return false;
  return true;
}

function unsupported(text, ev) {
  const bad = [];
  for (const c of travelClaims(text)) if (!claimVerified(c, ev.routes)) bad.push({ ...c, why: 'travel' });
  // Web search can back hours we can't check here; a place_hours result is
  // checked number by number.
  if (!ev.searched) {
    for (const m of String(text).matchAll(HOURS_RE)) {
      if (ev.hours.length && hoursVerified(m[0], ev.hours)) continue;
      bad.push({ index: m.index, length: m[0].length, text: m[0], why: 'hours' });
    }
  }
  if (!ev.searched) {
    for (const m of String(text).matchAll(PRICE_RE)) bad.push({ index: m.index, length: m[0].length, text: m[0], why: 'price' });
    for (const m of String(text).matchAll(RATING_RE)) bad.push({ index: m.index, length: m[0].length, text: m[0], why: 'rating' });
  }
  return bad;
}

// Sentences, keeping their end punctuation and the {{address:N}} tokens.
// Splits only at . ! ? followed by a space, so "14.6 miles" stays whole;
// "St. Pete" style abbreviations are glued back.
function sentences(text) {
  const parts = String(text || '').split(/(?<=[.!?])\s+/).filter((p) => p.trim());
  const out = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev && /(?:^|\s)(St|Mt|Dr|Ft|Mr|Mrs|Ms|vs|approx|No|[ap]\.m)\.$/i.test(prev.text)) prev.text += ' ' + p;
    else out.push({ text: p });
  }
  return out;
}

// Cut one bad claim from a sentence: its parenthetical, or the comma /
// dash clause holding it when the rest still reads as a sentence; else null
// (drop the whole sentence).
function cutClause(sentence, claimText) {
  const at = sentence.indexOf(claimText);
  if (at < 0) return null;
  const paren = /\([^()]*\)/g;
  let m;
  while ((m = paren.exec(sentence))) {
    if (m.index <= at && at < m.index + m[0].length) {
      return sentence.slice(0, m.index).replace(/\s+$/, '') + sentence.slice(m.index + m[0].length);
    }
  }
  const seps = [...sentence.matchAll(/\s*(?:,|—|–| - |;)\s*/g)].map((x) => ({ i: x.index, end: x.index + x[0].length }));
  const before = seps.filter((x) => x.end <= at).pop();
  const after = seps.find((x) => x.i >= at + claimText.length);
  if (!before && !after) return null;
  const start = before ? before.i : 0;
  const end = after ? (before ? after.i : after.end) : sentence.replace(/[.!?]+\s*$/, '').length;
  const rest = (sentence.slice(0, start) + sentence.slice(end)).replace(/\s{2,}/g, ' ').replace(/^\s*[,;]\s*/, '');
  const words = rest.replace(/\{\{address:\d+\}\}/g, 'x').match(/[A-Za-z]{2,}/g) || [];
  if (words.length < 3) return null;
  return /[.!?]\s*$/.test(rest) ? rest : rest.replace(/\s*$/, '') + (/[.!?]\s*$/.test(sentence) ? sentence.match(/[.!?]+\s*$/)[0] : '');
}

const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
export const routeSentence = (r) =>
  `${r.from?.name || 'Start'} to ${r.to?.name || 'there'}: ${r.miles} mi, about ${fmtMin(r.minutes)} ${r.mode === 'walking' ? 'walking' : 'driving with current traffic'} (Google Maps).`;

export const NEED_LOCATION = "Turn on location and I'll check the real distance from where you are.";
export const CANT_CHECK_DISTANCE = "I couldn't check the real distance right now, so I won't guess. Tap Directions on the card for the live route.";
const CANT_CHECK_HOURS = "I couldn't confirm their hours right now, so check before you go.";

// Returns { reply, removed } with every unbacked claim cut out. `askedTravel`
// is true for a "how far / how long" question: its reply must end up with a
// checked number (added from the route result when the AI left it out) or an
// honest "couldn't check".
export function guardReply(reply, { routes = [], webSearches = 0, hoursLookups = [], askedTravel = false, locationOff = false } = {}) {
  const ev = evidenceOf({ routes, webSearches, hoursLookups });
  const removed = [];
  const kept = [];
  for (const sent of sentences(reply)) {
    let t = sent.text;
    for (let guard = 0; guard < 12; guard++) {
      const bad = unsupported(t, ev);
      if (!bad.length) break;
      const next = cutClause(t, bad[0].text);
      if (next == null) {
        removed.push(...bad.map((b) => ({ text: b.text, why: b.why })));
        t = '';
        break;
      }
      removed.push({ text: bad[0].text, why: bad[0].why });
      t = next;
    }
    if (t.trim()) kept.push(t.trim());
  }
  let out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  const okRoutes = routes.filter((r) => r && !r.error && Number.isFinite(r.miles));
  const hasChecked = travelClaims(out).some((c) => c.kind !== 'vague' && claimVerified(c, okRoutes));
  if (askedTravel || removed.some((r) => r.why === 'travel')) {
    if (okRoutes.length && !hasChecked && (askedTravel || removed.some((r) => r.why === 'travel'))) {
      out = [out, ...okRoutes.slice(0, 3).map(routeSentence)].filter(Boolean).join(' ');
    } else if (!okRoutes.length && !hasChecked) {
      out = [out, locationOff ? NEED_LOCATION : CANT_CHECK_DISTANCE].filter(Boolean).join(' ');
    }
  }
  if (removed.some((r) => r.why === 'hours') && !/\b(open|close|hours)\b/i.test(out)) out = [out, CANT_CHECK_HOURS].filter(Boolean).join(' ');
  return { reply: out, removed };
}
