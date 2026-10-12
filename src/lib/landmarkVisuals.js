const PALETTES = [
  ['#8a6a3f', '#d9b876'],
  ['#5f6b4a', '#a9b183'],
  ['#6b4a42', '#c98f6e'],
  ['#3f5a63', '#8fb0b8'],
  ['#7a5240', '#cf9f6a'],
];

const CATEGORY_ICON = {
  'history-culture': '\u{1F3DB}\u{FE0F}',
  'art-museums': '\u{1F5BC}\u{FE0F}',
  food: '\u{1F37D}\u{FE0F}',
  'local-life': '\u{1F378}',
  sports: '\u{1F3C0}',
  'parks-nature': '\u{1F333}',
  'entertainment': '\u{1F39F}\u{FE0F}',
  stadiums: '\u{1F3DF}\u{FE0F}',
  'formula-1': '\u{1F3CE}\u{FE0F}',
  benches: '\u{1FA91}',
  tech: '\u{1F4BB}',
  airports: '\u{2708}\u{FE0F}',
  'campus-life': '\u{1F3EB}',
  dorms: '\u{1F6CF}\u{FE0F}',
};

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function paletteFor(id) {
  return PALETTES[hashStr(id) % PALETTES.length];
}

export function iconFor(categories) {
  return CATEGORY_ICON[categories?.[0]] || '\u{1F4CD}';
}

// A sports or stadium place whose name or kind names its sport gets that
// sport's icon instead of the generic basketball (Granada Golf Course: golf).
// First match wins, so the more specific words come first.
const SPORT_ICONS = [
  [/\bmini(ature)?[ -]?golf\b|\bputt/i, '\u{26F3}'],
  [/\bgolf\b|\bcountry club\b|\bdriving range\b/i, '\u{26F3}'],
  [/\btennis\b/i, '\u{1F3BE}'],
  [/\bpickleball\b|\bpadel\b|\bping[ -]?pong\b|\btable tennis\b/i, '\u{1F3D3}'],
  [/\bbaseball\b|\bsoftball\b|\bballpark\b|\bbatting cage/i, '\u{26BE}'],
  [/\bsoccer\b|\bfutbol\b|\bfútbol\b/i, '\u{26BD}'],
  [/\bfootball\b/i, '\u{1F3C8}'],
  [/\bvolleyball\b/i, '\u{1F3D0}'],
  [/\bhockey\b|\bice rink\b|\bskating rink\b|\bice skat/i, '\u{1F3D2}'],
  [/\bbowling\b|\blanes\b/i, '\u{1F3B3}'],
  [/\bswim|\bpool\b|\baquatic/i, '\u{1F3CA}'],
  [/surf/i, '\u{1F3C4}'],
  [/\bkayak|\bcanoe|\bpirag[uü]ismo\b|\bpaddle ?board|\bpaddling\b|\browing\b|\bcrew\b/i, '\u{1F6F6}'],
  [/\bmarina\b|\bsail|\byacht|\bboat/i, '\u{26F5}'],
  [/\bfishing\b|\bpier\b/i, '\u{1F3A3}'],
  [/\bskate ?park\b|\bskateboard/i, '\u{1F6F9}'],
  [/\bclimb|\bboulder/i, '\u{1F9D7}'],
  [/\bbik(e|ing)\b|\bcycl|\bbmx\b|\bvelodrome\b/i, '\u{1F6B4}'],
  [/\bkart|\braceway\b|\bspeedway\b|\bmotorsport|\bautodrome\b|\brace ?track\b/i, '\u{1F3CE}\u{FE0F}'],
  [/\bhorse|\bequestrian\b|\bhip[oó]dromo\b|\bippodromo\b|\bhippodrome\b|\bpolo\b|\bracecourse\b/i, '\u{1F3C7}'],
  [/\bbox(ing)?\b|\bmma\b|\bmartial arts?\b|\bjiu[ -]?jitsu\b|\bkarate\b/i, '\u{1F94A}'],
  [/\byoga\b|\bpilates\b/i, '\u{1F9D8}'],
  [/\bgym\b|\bfitness\b|\bcrossfit\b|\bweight/i, '\u{1F3CB}\u{FE0F}'],
  [/\bski\b|\bskiing\b|\bsnowboard/i, '\u{26F7}\u{FE0F}'],
  [/\bcricket\b/i, '\u{1F3CF}'],
  [/\brugby\b/i, '\u{1F3C9}'],
  [/\blacrosse\b/i, '\u{1F94D}'],
  [/\bbadminton\b/i, '\u{1F3F8}'],
  [/\barchery\b/i, '\u{1F3F9}'],
  [/\bshooting\b|\bgun range\b/i, '\u{1F3AF}'],
  [/\bbasketball\b/i, '\u{1F3C0}'],
];
const SPORTY = new Set(['sports', 'stadiums']);

export function sportIconFor(landmark) {
  if (!landmark?.categories?.some((c) => SPORTY.has(c))) return null;
  const text = [landmark.name, landmark.topic].filter(Boolean).join(' ');
  return SPORT_ICONS.find(([re]) => re.test(text))?.[1] || null;
}

// The icon for one place: its sport when the name says it, else its category's.
export function landmarkIcon(landmark) {
  return sportIconFor(landmark) || iconFor(landmark?.categories);
}
