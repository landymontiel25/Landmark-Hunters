import { FieldValue } from 'firebase-admin/firestore';
import { mainKinds, placeTasteWeight } from '../../src/lib/placeKinds.js';
import { getLandmark } from '../../src/data/regions.js';

// Mapr's memory of a traveler's taste (owner, 2026-11-24: "remembering his
// taste is the most important part of the entire app"). Built on the server
// from everything the account has done, read fresh from Firestore on every
// Mapr reply, so it grows with each rating and check-in:
//   ratings           the tier ("I loved it" / "Ok" / "Not for me")
//   "Would you come back?"  the strongest signal (placeKinds RETURN_WEIGHT)
//   check-ins         repeat visits to a place count as liking it
// Each place's weight (placeTasteWeight) goes to the kinds of place it is
// (placeKinds.js: pizza, steakhouse, seafood, beach, museum...), so a pizza
// lover's pizza places add up and pizza leads their picks. The result goes
// into Mapr's context (TASTE MEMORY) and into the ranking (as reviews), and
// a snapshot is kept at mapr_taste/{uid} (server-only; the owner reads it).

const MAX_REVIEWS = 400;
const MAX_CHECKINS = 800;
const toMs = (t) => (typeof t?.toMillis === 'function' ? t.toMillis() : Number.isFinite(t?.seconds) ? t.seconds * 1000 : Number.isFinite(t) ? t : 0);
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Pure: ratings and check-ins -> the memory.
//   reviews:  [{ landmarkId, region, landmarkName, ratingTier, wouldReturn, comment, categories, ratedAt }]
//   checkins: [{ landmarkId, region, landmarkName, createdAtMs }]  (real visits only)
export function buildTasteMemory({ reviews = [], checkins = [], findPlace = (r) => (r.region ? getLandmark(r.region, r.landmarkId) : null) } = {}) {
  const places = new Map();
  const key = (x) => `${x.region || ''}/${x.landmarkId}`;
  for (const c of checkins) {
    if (!c?.landmarkId) continue;
    const p = places.get(key(c)) || { landmarkId: c.landmarkId, region: c.region || null, name: clean(c.landmarkName, 80), visits: 0, lastAt: 0 };
    p.visits += 1;
    p.lastAt = Math.max(p.lastAt, c.createdAtMs || 0);
    places.set(key(c), p);
  }
  for (const r of reviews) {
    if (!r?.landmarkId || !r.ratingTier) continue;
    const p = places.get(key(r)) || { landmarkId: r.landmarkId, region: r.region || null, name: '', visits: 0, lastAt: 0 };
    p.name = clean(r.landmarkName, 80) || p.name;
    p.ratingTier = r.ratingTier;
    p.wouldReturn = r.wouldReturn || null;
    p.comment = clean(r.comment, 160);
    p.categories = Array.isArray(r.categories) ? r.categories : [];
    p.lastAt = Math.max(p.lastAt, toMs(r.ratedAt));
    places.set(key(r), p);
  }
  const kinds = new Map();
  const list = [];
  for (const p of places.values()) {
    const weight = placeTasteWeight(p) || (p.visits > 1 ? Math.min(p.visits - 1, 3) : 0);
    const place = findPlace(p) || { name: p.name, categories: p.categories || [] };
    p.name = p.name || clean(place.name, 80);
    p.weight = weight;
    p.kinds = [...mainKinds(place)];
    list.push(p);
    if (!weight) continue;
    for (const k of p.kinds) {
      const e = kinds.get(k) || { kind: k, score: 0, places: [] };
      e.score += weight;
      e.places.push({ name: p.name, weight });
      kinds.set(k, e);
    }
  }
  const byStrength = (a, b) => b.score - a.score || a.kind.localeCompare(b.kind);
  const all = [...kinds.values()].map((e) => ({ ...e, places: e.places.sort((a, b) => b.weight - a.weight).map((x) => x.name).slice(0, 4) }));
  return {
    loves: all.filter((e) => e.score >= 3).sort(byStrength).slice(0, 10),
    avoids: all.filter((e) => e.score <= -3).sort((a, b) => a.score - b.score).slice(0, 8),
    goBack: list.filter((p) => p.wouldReturn === 'yes').sort((a, b) => b.weight - a.weight || b.lastAt - a.lastAt).map((p) => p.name).filter(Boolean).slice(0, 10),
    neverAgain: list.filter((p) => p.wouldReturn === 'never-again' || p.ratingTier === 'probably-skip').map((p) => p.name).filter(Boolean).slice(0, 10),
    regulars: list.filter((p) => p.visits >= 2).sort((a, b) => b.visits - a.visits).map((p) => ({ name: p.name, visits: p.visits })).filter((p) => p.name).slice(0, 8),
    // For the ranking: one entry per rated or visited place, with its weight inputs.
    reviews: list
      .filter((p) => p.ratingTier || p.visits)
      .map((p) => ({ landmarkId: p.landmarkId, region: p.region, name: p.name, tier: p.ratingTier || null, wouldReturn: p.wouldReturn || null, visits: p.visits, categories: p.categories || [], visited: p.visits > 0 })),
    rated: list.filter((p) => p.ratingTier).length,
    visits: list.reduce((n, p) => n + p.visits, 0),
  };
}

// The block Mapr reads. Empty when there's nothing to go on yet.
export function tasteMemoryText(m) {
  if (!m || (!m.rated && !m.visits)) return '';
  const kindLine = (e) => `${e.kind.replace(/-/g, ' ')} (${e.score > 0 ? '+' : ''}${e.score}: ${e.places.join(', ')})`;
  const lines = [
    `TASTE MEMORY (what I've learned from all ${m.rated} of their ratings, every "Would you come back?" answer and all ${m.visits} check-ins; it grows with each one; strongest first):`,
  ];
  if (m.loves.length) lines.push(`- Kinds of place they love: ${m.loves.map(kindLine).join('; ')}`);
  if (m.goBack.length) lines.push(`- Said they'd come back to: ${m.goBack.join(', ')}`);
  if (m.regulars.length) lines.push(`- Keeps going back to: ${m.regulars.map((r) => `${r.name} (${r.visits} visits)`).join(', ')}`);
  if (m.avoids.length) lines.push(`- Kinds they avoid: ${m.avoids.map(kindLine).join('; ')}`);
  if (m.neverAgain.length) lines.push(`- Not for them / never again: ${m.neverAgain.join(', ')}`);
  lines.push(
    'How to use it: this is the most important thing you know about them. For any open-ended or food ask, lead with the kinds they love ' +
      '(a pizza lover asking for dinner gets a pizza place first), put those words in your web_search query when you search, and say why in ' +
      'a few words ("since you loved Nippers"). Never suggest a kind they avoid or a place they said never again. When what they ask for in ' +
      'this message differs (they ask for sushi), follow the message.'
  );
  return lines.join('\n');
}

// Reads the account's ratings and real check-ins and builds the memory.
export async function loadTasteMemory(db, uid) {
  const [rs, cs] = await Promise.all([
    db.collection('reviews').where('userId', '==', uid).limit(MAX_REVIEWS).get(),
    db.collection('checkins').where('userId', '==', uid).select('landmarkId', 'region', 'landmarkName', 'createdAt', 'ratingOnly', 'visited', 'points').limit(MAX_CHECKINS).get(),
  ]);
  const reviews = rs.docs.map((d) => d.data()).filter((r) => r.ratingTier);
  const checkins = cs.docs
    .map((d) => d.data())
    .filter((c) => !c.ratingOnly && (typeof c.visited === 'boolean' ? c.visited : c.points !== 0))
    .map((c) => ({ landmarkId: c.landmarkId, region: c.region, landmarkName: c.landmarkName, createdAtMs: toMs(c.createdAt) }));
  return buildTasteMemory({ reviews, checkins });
}

// Kept so the profile builds over time and the owner can see it. Best effort.
export function saveTasteSnapshot(db, uid, m) {
  if (!m || (!m.rated && !m.visits)) return Promise.resolve();
  return db
    .collection('mapr_taste')
    .doc(uid)
    .set({
      loves: m.loves.map((e) => ({ kind: e.kind, score: e.score, places: e.places })),
      avoids: m.avoids.map((e) => ({ kind: e.kind, score: e.score, places: e.places })),
      goBack: m.goBack,
      neverAgain: m.neverAgain,
      regulars: m.regulars,
      rated: m.rated,
      visits: m.visits,
      updatedAt: FieldValue.serverTimestamp(),
    })
    .catch(() => {});
}
