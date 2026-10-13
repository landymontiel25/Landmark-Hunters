// Nightlife is bars, pubs, clubs and live music. When Entertainment was
// folded into it (2026-10-12), shows, zoos, aquariums and theme parks came
// along; this sorts them back out at load (data/regions.js normalizeLandmark),
// so pack files and landmark files stay as they are:
//   Attractions   aquariums, zoos, theme parks, bowling, arcades, boat tours...
//   Art & Culture theaters, opera, concert halls, cinemas, planetariums
//   Nightlife     everything else that was there (bars, clubs, live music,
//                 cabaret, flamenco, casinos)
// Returns the new category id, or null to keep it in Nightlife.

const ATTRACTION = /\b(aquarium|seaquarium|oceanarium|zoo|wildlife|safari|jungle island|theme park|amusement|parque de atracciones|water ?park|roller ?coaster|bowl(ing|ero)?|arcade|mini ?golf|escape room|trampoline|ferris|observation wheel|cape wheel|coney island|pier 39|mus[eé]e m[eé]canique|airboat|boat (tour|cruise)|bay cruise|harbou?r cruise|children'?s museum|cirque|great america|strawberry train|tren de la fresa|go-?kart|kings dining)\b/i;
const CULTURE = /\b(theat(er|re)s?|teatro|th[eé][aâ]tre|opera|op[eé]ra|symphony|philharmoni[ac]|philharmonie|concert hall|tonhalle|carnegie hall|lincoln center|radio city|auditori(um|o)|performing arts|arts cent(er|re)|playhouse|kimmel center|academy of music|alte oper|kkl|ballet|zarzuela|coliseo|scala|cinema|cine\b|cines\b|film (center|forum|institute)|filmoteca|ifc center|movie|art cinema|drafthouse|grand rex|planetari(um|o)|broadway|piccolo teatro|real coliseo|baxter|artscape|bam\b|brooklyn academy)\b/i;
// Live music and nightlife venues whose names say "theater" or "hall" but
// are concert clubs, not stages for plays.
const STAY_NIGHTLIFE = /\b(music hall|ballroom|union transfer|trocadero|fillmore|bowery|jazz|blue note|birdland|village vanguard|caveau|duplex|moulin rouge|folies berg[eè]re|cabaret|tablao|flamenco|corral de la morer[ií]a|villa rosa|cardamomo|joy eslava|kapital|sala el sol|magazzini generali|alcatraz|l'olympia|casino|hoy como ayer|ball & chain|caf[eé] la trova|mango'?s|beacon theatre|comedy|improv|punch line|comedysportz|city winery|milkboy|theatre of living arts|the independent|warfield|drafthouse bar|interstate drafthouse)\b|^(the met|guild|the tower theater)$/i;
// Named stages that read like music venues but are theaters and concert
// halls for the arts; checked before STAY_NIGHTLIFE.
const CULTURE_FIRST = /\b(radio city|apollo theater|olympia theater|tower theater miami)\b/i;

const TOPIC_ATTRACTION = new Set(['zoo', 'aquarium', 'boat tour', 'theme park', 'water park', 'bowling alley', 'arcade', 'miniature golf']);
const TOPIC_CULTURE = new Set(['theater', 'movie theater', 'cinema', 'opera house', 'concert hall', 'planetarium', 'arts center']);

export function nightlifeHome(l) {
  const topic = String(l?.topic || '').toLowerCase();
  const name = String(l?.name || '');
  const text = `${name} ${l?.summary || ''}`;
  if (TOPIC_ATTRACTION.has(topic)) return 'attractions';
  if (CULTURE_FIRST.test(name)) return 'history-culture';
  if (STAY_NIGHTLIFE.test(name)) return null;
  if (TOPIC_CULTURE.has(topic)) return 'history-culture';
  if (ATTRACTION.test(name)) return 'attractions';
  if (CULTURE.test(name)) return 'history-culture';
  // Hand-picked places without a telling name: read the summary, but only
  // when it doesn't also call itself a bar, club or music venue.
  if (/\b(bar|pub|tavern|club|nightclub|cocktail|beer|brew|ale house|live music|jazz|music venue|dance)\b/i.test(text)) return null;
  if (ATTRACTION.test(text)) return 'attractions';
  if (CULTURE.test(text)) return 'history-culture';
  return null;
}
