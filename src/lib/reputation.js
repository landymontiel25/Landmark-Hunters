// Influence events and local reputation (docs/discovery-network-plan.md,
// steps 8 and 9). Pure, so the nightly job (api/_lib/reputationJob.js) and
// its tests agree. People see only a level ("Local", "Trusted",
// "Insider") and badges, never points or events.

// Step 8: what other people do with a finder's tip.
export const EVENT_WEIGHTS = { helpful: 1, saved: 2, went: 10, loved: 5 };
export const WENT_WINDOW_DAYS = 30; // a verified visit within 30 days of seeing the tip

// Step 9.
export const PERSON_CAP = 15; // (v2) one person adds at most 15
export const HALF_LIFE_DAYS = 180;
export const TRUST = { established: 1, friend: 0.5, other: 0.3 };
export const ESTABLISHED = { verifiedCheckins: 3, ageDays: 14 };
export const LEVELS = [
  // Highest first.
  { id: 'Insider', score: 250, people: 25, topShare: 0.05 },
  { id: 'Trusted', score: 80, people: 10 },
  { id: 'Local', score: 20, people: 3 },
];
// Reputation as finder weight's 0-to-1 input: the score over the Insider
// bar, capped at 1.
export const REPUTATION_FULL = 250;
export const FOUNDING_LIMIT = 25;

const DAY_MS = 86400000;

export const decay = (ageDays) => 0.5 ** (Math.max(0, ageDays) / HALF_LIFE_DAYS);

// Trust of the person behind an event, for this finder: their friends 0.5
// (friend rings stay weak), an account with 3 or more verified check-ins
// that is older than 14 days 1.0, anyone else 0.3.
export function trustOf({ isFriend = false, verifiedCheckins = 0, accountAgeDays = 0 } = {}) {
  if (isFriend) return TRUST.friend;
  if (verifiedCheckins >= ESTABLISHED.verifiedCheckins && accountAgeDays > ESTABLISHED.ageDays) return TRUST.established;
  return TRUST.other;
}

// One finder's reputation in one city from that city's events:
// sum over other people of min(15, their decayed event weights) x trust.
// events: [{ actorUid, weight, at }]; trust(actorUid) -> 0.3 to 1.
export function reputationScore(events, { finderUid, nowMs = Date.now(), trust = () => TRUST.other } = {}) {
  const byPerson = new Map();
  for (const e of events || []) {
    if (!e?.actorUid || e.actorUid === finderUid || !Number.isFinite(e.weight)) continue;
    const ageDays = Number.isFinite(e.at) ? (nowMs - e.at) / DAY_MS : 0;
    byPerson.set(e.actorUid, (byPerson.get(e.actorUid) || 0) + e.weight * decay(ageDays));
  }
  let score = 0;
  for (const [actor, sum] of byPerson) score += Math.min(PERSON_CAP, sum) * trust(actor);
  return { score, people: byPerson.size };
}

// Levels in one city. scores: [{ uid, score, people }]. Insider also needs
// the top 5% of the city's finders with any score.
export function levelsFor(scores) {
  const ranked = [...(scores || [])].filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const topN = Math.max(1, Math.ceil(ranked.length * LEVELS[0].topShare));
  const out = new Map();
  ranked.forEach((s, i) => {
    const level = LEVELS.find((l) => s.score >= l.score && s.people >= l.people && (!l.topShare || i < topN));
    if (level) out.set(s.uid, level.id);
  });
  return out;
}

export const reputation01 = (score) => (Number.isFinite(score) && score > 0 ? Math.min(1, score / REPUTATION_FULL) : 0);

export const LEVEL_RANK = { Local: 1, Trusted: 2, Insider: 3 };
// Trusted and Insider finds reach people who don't follow the finder.
export const reachesEveryone = (level) => (LEVEL_RANK[level] || 0) >= LEVEL_RANK.Trusted;
