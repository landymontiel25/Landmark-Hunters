import { TAG_DELTAS } from './tagScores';

// Onboarding swipe cards. Each card shows one word, but it scores one of the
// app's real category tags (INTERESTS ids in src/data/regions.js) -- tagScores
// is keyed by those, so "Steak" moves `food`, "Racing" moves `formula-1`.

// One Wikimedia Commons file per card (free licenses, mostly CC BY-SA), picked
// to show the kind of place. Fixed per card; an array shows as a split photo.
export const CARD_PHOTOS = {
  "Steak": "Bavette's Steakhouse & Bar - March 2022 - Sarah Stierch 05.jpg",
  "Pizza": "NYPizzaPie.jpg",
  "Sushi": "Sushi platter.jpg",
  "Fine dining": "Train bleu 05 bearbeitet.jpg",
  "Street food": "Myeongdong night market seoul 4.jpg",
  "Coffee shops": "Tazzina di caffè a Ventimiglia.jpg",
  "Museums": "Grande Galerie, Louvre Museum, 25 September 2019 01.jpg",
  "Historic architecture": "West facade of Petit Trianon 002.JPG",
  "Old churches": "Notre-Dame de Paris, 4 October 2017.jpg",
  "Ruins": "Machu Picchu, 2023 (012).jpg",
  "Castles": "Panorámica Otoño Alcázar de Segovia.jpg",
  "Hiking trails": "Hiking to the Ice Lakes. San Juan National Forest, Colorado.jpg",
  "Scenic views": "Vista de Varenna, lago de Como, Italia, 2016-06-25, DD 10.jpg",
  "Beaches": "Beach at Fort Lauderdale.jpg",
  "Gardens": "Rows of tulips and trees at Keukenhof gardens.jpg",
  "Waterfalls": "Cascada Dynjandi, Vestfirðir, Islandia, 2014-08-14, DD 136-138 HDR.JPG",
  "Lakes/rivers": "Pirogue running on the Mekong at golden hour between Don Det and Don Khon Laos.jpg",
  "Live music": "Dülmen, Dülmener Sommer, Open-Air-Konzert, \"Bounce\" -- 2018 -- 0051.jpg",
  "Comedy shows": "Kevin Hart (15789082350).jpg",
  "Theme parks": "Luna Park Melbourne scenic railway.jpg",
  "Aquariums": "Male whale shark at Georgia Aquarium.jpg",
  "Zoos": "Bronx Zoo 001.jpg",
  "Casinos": "Fontainebleau Las Vegas Casino Floor.jpg",
  "Arcades/bowling": ["Pac-Man arcade machine, De Notaris Schaijk.jpg", "AMF bowling center.jpg"],
  "Festivals": "Tomorrowland2016mainstage.jpg",
  "Golf": "Ballybunion Golf Club - 10th hole.jpg",
  "Pickleball": "Pickle Pro Tour 2025 2.jpg",
  "Racing": "First lap 2014 Bahrain Grand Prix (3).jpg",
  "Stadium games": "Fenway Park 20-April-2021.jpg",
  "Boating": "Century 2400 CC.jpg",
  "Fishing": "Mete (fiske) - Ystad-2018.jpg",
  "Tennis": "Ivanovic-Shvedova-Lenglen-RG2015.jpg",
  "Watersports": "CH.ZG.Zug Boardstock 2008-07-27 Wakeboarder 27 16x9-R 4K.jpg",
  "Nightlife/clubs": "Wikipedia space ibiza(03).jpg",
  "Dive bars": "DFC 0512 Dimly lit bar interior with neon signs and rows of taps glowing under red and purple lighting ready for the night crowd.jpg",
  "Rooftop bars": "Interior of Eleven Rooftop Bar, Fortiude Valley, Brisbane, 01.jpg",
  "Farmers markets": "DSCF1116 Fresh root vegetables piled at a bustling market stall with fruits and produce blurred in the colorful background.jpg",
  "Luxury spots": "Infinity Edge Pool, Mauritius.JPG",
  "Shopping": "Galleria Milano (179532365).jpeg",
};

// Crop anchor for tall photos whose subject sits high in the frame.
export const CARD_PHOTO_POSITION = {
  "Comedy shows": 'center 20%',
};

const commonsUrl = (file, width) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
export const commonsPage = (file) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, '_'))}`;

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
  cards: g.cards.map(([word, icon, tag]) => ({
    word,
    icon,
    group: g.id,
    tag: tag || g.tag || g.id,
    // Two files show side by side as a split photo.
    photos: [CARD_PHOTOS[word]].flat().map((f) => commonsUrl(f, 800)),
    photoPages: [CARD_PHOTOS[word]].flat().map(commonsPage),
    photoPosition: CARD_PHOTO_POSITION[word] || null,
  })),
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

// Test tab shows every card grouped by category, in the order declared above,
// so a reviewer can go through one category at a time instead of a shuffled mix.
export function allSwipeCards() {
  return [...ALL_SWIPE_CARDS];
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
