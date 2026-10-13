// Grades one Mapr chat reply against the simulated world's truth. Uses its
// own fact readers (not the guard's) for hours, prices and ratings; travel
// claims are read with the guard's parser but checked against the TRUE
// routes, not against what the tools happened to return.
import { claimVerified, travelClaims, CANT_CHECK_DISTANCE, NEED_LOCATION } from '../../api/_lib/factGuard.js';

const TIME = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/gi;
const PRICE = /\$\s?(\d[\d,]*)/g;
const STARS = /(\d(?:\.\d)?)\s?(?:stars?|★|\/\s?5|out of 5)|rated\s(\d(?:\.\d)?)/gi;

const to24 = (h, ap) => (Number(h) % 12) + (ap.toLowerCase() === 'p' ? 12 : 0);

export function factsIn(reply) {
  const s = String(reply || '');
  const out = [];
  for (const c of travelClaims(s)) out.push({ type: 'travel', claim: c });
  for (const sent of s.split(/(?<=[.!?])\s+/)) {
    if (!/\b(open|close|closes|closed|until|till|opens)\b/i.test(sent)) continue;
    for (const m of sent.matchAll(TIME)) out.push({ type: 'hour', value: to24(m[1], m[3]), text: m[0], sentence: sent });
    const now = sent.match(/\b(open|closed) now\b/i);
    if (now) out.push({ type: 'openNow', value: now[1].toLowerCase() === 'open', text: now[0], sentence: sent });
  }
  for (const m of s.matchAll(PRICE)) out.push({ type: 'price', value: Number(m[1].replace(/,/g, '')), text: m[0] });
  for (const m of s.matchAll(STARS)) out.push({ type: 'rating', value: Number(m[1] || m[2]), text: m[0] });
  return out;
}

// truth: { routes: [...], places: [{ open, close, openNow, price, rating }] }
export function isTrue(fact, truth) {
  switch (fact.type) {
    case 'travel':
      return claimVerified(fact.claim, truth.routes);
    case 'hour':
      return truth.places.some((p) => fact.value === p.open % 24 || fact.value === p.close % 24);
    case 'openNow':
      return truth.places.some((p) => p.openNow === fact.value);
    case 'price':
      return truth.places.some((p) => p.price === fact.value);
    case 'rating':
      return truth.places.some((p) => Math.abs(p.rating - fact.value) < 0.05);
    default:
      return true;
  }
}

export function gradeReply({ raw, shown, truth, askedTravel, canAnswer, toolRoutes = [] }) {
  const before = factsIn(raw);
  const after = factsIn(shown);
  const wrongBefore = before.filter((f) => !isTrue(f, truth));
  const wrongAfter = after.filter((f) => !isTrue(f, truth));
  const rightBefore = before.filter((f) => isTrue(f, truth));
  // A true travel fact a lookup backed, cut anyway: a guard bug.
  const overCut = rightBefore.filter((f) => f.type === 'travel' && claimVerified(f.claim, toolRoutes) && !String(shown).includes(f.claim.text));
  const answered = after.some((f) => f.type === 'travel' && f.claim.kind !== 'vague' && isTrue(f, truth));
  const honest = String(shown).includes(CANT_CHECK_DISTANCE) || String(shown).includes(NEED_LOCATION) || /couldn'?t check/i.test(shown);
  return {
    wrongBefore,
    wrongAfter,
    overCut,
    unanswered: askedTravel && canAnswer && !answered && !honest,
    noAnswerNoHonesty: askedTravel && !answered && !honest,
  };
}
