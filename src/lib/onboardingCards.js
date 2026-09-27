import { TAG_DELTAS } from './tagScores';

// Onboarding swipe cards. Each card shows one word, but it scores one of the
// app's real category tags (INTERESTS ids in src/data/regions.js) -- tagScores
// is keyed by those, so "Steak" moves `food`, "Racing" moves `formula-1`.
// Photos are placeholders (icon on the category's gradient) until generic,
// non-identifiable stock photos are added.
export const SWIPE_GROUPS = [
  {
    id: 'food',
    label: 'Food',
    cards: [
      ['Steak', '\u{1F969}'],
      ['Pizza', '\u{1F355}'],
      ['Sushi', '\u{1F363}'],
      ['Fine dining', '\u{1F377}'],
      ['Street food', '\u{1F32E}'],
      ['Coffee shops', '\u{2615}'],
    ],
  },
  {
    id: 'history',
    label: 'History & Culture',
    tag: 'history-culture',
    cards: [
      ['Museums', '\u{1F5BC}\u{FE0F}', 'art-museums'],
      ['Historic architecture', '\u{1F3DB}\u{FE0F}'],
      ['Old churches', '\u{26EA}'],
      ['Battlefields', '\u{2694}\u{FE0F}'],
      ['Ruins', '\u{1F3DA}\u{FE0F}'],
      ['Castles', '\u{1F3F0}'],
    ],
  },
  {
    id: 'nature',
    label: 'Parks & Nature',
    tag: 'parks-nature',
    cards: [
      ['Hiking trails', '\u{1F97E}'],
      ['Scenic views', '\u{1F304}'],
      ['Beaches', '\u{1F3D6}\u{FE0F}'],
      ['Gardens', '\u{1F337}'],
      ['Waterfalls', '\u{1F4A7}'],
      ['Lakes/rivers', '\u{1F6F6}'],
    ],
  },
  {
    id: 'entertainment',
    label: 'Entertainment',
    tag: 'entertainment',
    cards: [
      // The catalog files live-music venues under Local Life.
      ['Live music', '\u{1F3B8}', 'local-life'],
      ['Comedy shows', '\u{1F3A4}'],
      ['Theme parks', '\u{1F3A2}'],
      ['Aquariums', '\u{1F420}'],
      ['Zoos', '\u{1F992}'],
      ['Casinos', '\u{1F3B0}'],
      ['Arcades/bowling', '\u{1F3B3}'],
      ['Festivals', '\u{1F3AA}'],
    ],
  },
  {
    id: 'sports',
    label: 'Sports & Activities',
    tag: 'sports',
    cards: [
      ['Golf', '\u{26F3}'],
      ['Pickleball', '\u{1F3D3}'],
      ['Racing', '\u{1F3CE}\u{FE0F}', 'formula-1'],
      ['Stadium games', '\u{1F3DF}\u{FE0F}', 'stadiums'],
      ['Boating', '\u{1F6A4}'],
      ['Fishing', '\u{1F3A3}'],
      ['Tennis', '\u{1F3BE}'],
      ['Watersports', '\u{1F3C4}'],
    ],
  },
  {
    id: 'local',
    label: 'Local Life',
    tag: 'local-life',
    cards: [
      ['Nightlife/clubs', '\u{1FAA9}'],
      ['Dive bars', '\u{1F37A}'],
      ['Rooftop bars', '\u{1F378}'],
      // Food markets are filed under Food.
      ['Farmers markets', '\u{1F955}', 'food'],
      ['Luxury spots', '\u{1F48E}'],
      ['Shopping', '\u{1F6CD}\u{FE0F}'],
    ],
  },
].map((g) => ({
  ...g,
  cards: g.cards.map(([word, icon, tag]) => ({ word, icon, group: g.id, tag: tag || g.tag || g.id })),
}));

export const ALL_SWIPE_CARDS = SWIPE_GROUPS.flatMap((g) => g.cards);

export const SWIPE_DELTAS = {
  love: TAG_DELTAS['highly-recommend'],
  dislike: TAG_DELTAS['probably-skip'],
  unsure: 0,
};

function shuffle(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 15-18 cards: 3 from each of the 6 groups, then 0-3 random groups drop to 2.
// Which cards each group shows is random, so every card gets coverage across
// signups over time. Groups are interleaved rather than shown in blocks.
export function pickSwipeCards(random = Math.random) {
  const drop = new Set(shuffle(SWIPE_GROUPS.map((g) => g.id), random).slice(0, Math.floor(random() * 4)));
  const picked = SWIPE_GROUPS.flatMap((g) => shuffle(g.cards, random).slice(0, drop.has(g.id) ? 2 : 3));
  return shuffle(picked, random);
}

export function allSwipeCards(random = Math.random) {
  return shuffle(ALL_SWIPE_CARDS, random);
}

// The card words themselves, in prose for Mapr's "in their own words" context:
// tagScores alone can't tell Steak from Sushi, Mapr reading this can.
export function tasteIntroFromAnswers(answers, notes = '') {
  const words = (a) => answers.filter((x) => x.answer === a).map((x) => x.card.word);
  const parts = [];
  if (words('love').length) parts.push(`Loves: ${words('love').join(', ')}.`);
  if (words('dislike').length) parts.push(`Doesn't like: ${words('dislike').join(', ')}.`);
  if (words('unsure').length) parts.push(`Not sure about: ${words('unsure').join(', ')}.`);
  if (notes.trim()) parts.push(`Also said: ${notes.trim()}`);
  return parts.join(' ');
}

// Net change per tag from a set of answers ({ card, answer }).
export function tagDeltasFromAnswers(answers) {
  const out = {};
  for (const { card, answer } of answers) {
    const d = SWIPE_DELTAS[answer] || 0;
    if (d) out[card.tag] = (out[card.tag] || 0) + d;
  }
  return out;
}
