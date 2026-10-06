import { seededRandom } from '../../src/lib/maprRank/experiments.js';
import { NCF as PROD_NCF } from '../../src/lib/maprRank/config.js';

// Data for the dashboard's testing lab. Every card on a lab desk is a real
// question asked of the model being trained: a synthetic user, two places
// from their VALIDATION split (one they loved or rated 4-5, one they rated
// lower or skipped), and which one Mapr ranks higher right now. Mapr's score
// is the full production blend (0.4 x normalized tag+similarity base + 0.6 x
// NCF), re-scored after every epoch, so the lab shows the model learning (or
// not). Separate RNG: the lab never changes training or results.

const FIRST = ['Avery', 'Jordan', 'Riley', 'Sam', 'Alex', 'Taylor', 'Casey', 'Morgan', 'Jamie', 'Quinn', 'Rowan', 'Skyler', 'Dakota', 'Reese', 'Emerson', 'Finley', 'Harper', 'Kai', 'Logan', 'Parker', 'Sage', 'Blake', 'Charlie', 'Drew', 'Ellis', 'Frankie', 'Hayden', 'Jesse', 'Kendall', 'Lane', 'Marley', 'Noel', 'Oakley', 'Peyton', 'Remy', 'Shay', 'Tatum', 'Arden', 'Bailey', 'Cameron', 'Devon', 'Eden', 'Gray', 'Indigo', 'Jules', 'Kit', 'Lennon', 'Milan', 'Nico', 'Ocean'];
const LAST = 'ABCDEFGHJKLMNPRSTVWZ';

export function fakeName(userId) {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${FIRST[h % FIRST.length]} ${LAST[(h >>> 8) % LAST.length]}.`;
}

export const LAB_USERS = 800;
const PAIRS_PER_USER = 3;
const CARDS = 12;

// users: [{ n, user, likedRows, otherRows, baseOf: Map(item -> base), maxBase }]
export function buildLab({ ds, places, users }) {
  const pairs = [];
  for (const u of users) {
    let k = 0;
    for (const a of u.likedRows) {
      for (const b of u.otherRows) {
        if (k++ >= PAIRS_PER_USER) break;
        const ia = ds.item[a];
        const ib = ds.item[b];
        const norm = (i) => (u.maxBase > 0 ? Math.max(0, u.baseOf.get(i)) / u.maxBase : 0);
        pairs.push({
          n: u.n,
          liked: ia,
          other: ib,
          baseLiked: norm(ia),
          baseOther: norm(ib),
          card: {
            user: fakeName(u.user.user_id),
            user_id: u.user.user_id,
            archetype: u.user.archetype,
            city: u.user.city,
            liked: { name: places[ia].name, stars: ds.rating[a], love: ds.love[a] === 1 },
            other: { name: places[ib].name, stars: ds.rating[b] || null },
          },
        });
      }
    }
  }
  return { pairs, tick: 0 };
}

// Scores every lab pair with the model as it is now.
export function labSnapshot(lab, ncf, { batch, sim, epoch }) {
  if (!lab.pairs.length) return null;
  let ncfRight = 0;
  let maprRight = 0;
  const outcome = new Array(lab.pairs.length);
  lab.pairs.forEach((p, k) => {
    const sl = ncf.score(p.n, p.liked);
    const so = ncf.score(p.n, p.other);
    if (sl > so) ncfRight++;
    const ml = PROD_NCF.baseWeight * p.baseLiked + PROD_NCF.ncfWeight * sl;
    const mo = PROD_NCF.baseWeight * p.baseOther + PROD_NCF.ncfWeight * so;
    const right = ml > mo;
    if (right) maprRight++;
    outcome[k] = right;
  });
  const rng = seededRandom(1 + lab.tick++ * 7919 + sim * 31);
  const cards = [];
  const used = new Set();
  while (cards.length < Math.min(CARDS, lab.pairs.length)) {
    const k = Math.floor(rng() * lab.pairs.length);
    if (used.has(k)) continue;
    used.add(k);
    const p = lab.pairs[k];
    cards.push({ ...p.card, picked: outcome[k] ? 'liked' : 'other', correct: outcome[k] });
  }
  return { batch, sim, epoch, pairs: lab.pairs.length, mapr_accuracy: maprRight / lab.pairs.length, ncf_accuracy: ncfRight / lab.pairs.length, cards };
}
