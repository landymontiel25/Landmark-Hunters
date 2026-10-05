// "Because you liked" check for San Francisco: for each liked place below,
// what similarPlaces (src/lib/nearbyPicks.js) suggests from every San
// Francisco place (catalog + imported packs) within 25 miles of Union Square,
// with each suggestion's kinds (src/lib/placeKinds.js).
//   node scripts/osm-import/research/sf/liked-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { REGIONS } from '../../../../src/data/regions.js';
import { PLACE_PACKS } from '../../../../src/data/placePacks.manifest.js';
import { similarPlaces } from '../../../../src/lib/nearbyPicks.js';
import { placeKinds, mainKinds } from '../../../../src/lib/placeKinds.js';
import { distanceMeters } from '../../transform.js';

const UNION_SQUARE = [37.788, -122.4075];
const MILES_25 = 25 * 1609.34;
// [what the liked place stands for, its name]
const LIKED = [
  ['steakhouse', 'BullsHead Restaurant'],
  ['sushi', 'Chacho Sushi'],
  ['burgers', 'Hi-Way'],
  ['pizza', "Tony's Pizza Napoletana"],
  ['coffee', 'Sightglass Coffee Flagship'],
  ['cocktail bar', 'Smuggler\'s Cove'],
  ['brewery', 'Cellarmaker'],
  ['museum', 'San Francisco Museum of Modern Art'],
  ['park', 'Alamo Square'],
  ['Mexican', 'Taqueria Dos Charros'],
  ['Chinese', 'Sam Wo Restaurant'],
  ['Italian', 'Sotto Mare'],
  ['bakery', 'Liguria Bakery'],
  ['seafood', "Scoma's"],
  ['dim sum', 'Dumpling House'],
];

const sf = REGIONS.find((r) => r.id === 'san-francisco');
const packed = PLACE_PACKS.filter((p) => p.region === 'san-francisco').flatMap((p) => JSON.parse(fs.readFileSync(path.join('public', p.file), 'utf8')));
const all = [...sf.landmarks, ...packed].map((l) => ({ ...l, regionId: 'san-francisco', distanceMeters: distanceMeters(UNION_SQUARE[0], UNION_SQUARE[1], l.lat, l.lng) }));
const pool = all.filter((l) => l.distanceMeters <= MILES_25);
const pick = process.argv[2] ? JSON.parse(process.argv[2]) : LIKED;
for (const [label, name] of pick) {
  const liked = all.find((l) => l.name === name);
  if (!liked) {
    console.log(`\n${label}: ${name} not found`);
    continue;
  }
  console.log(`\n${label}: ${name} {${mainKinds(liked).join(',')}}`);
  for (const p of similarPlaces({ liked, pool })) {
    const full = all.find((l) => l.id === p.id);
    console.log(`  - ${p.name} [${full.topic || full.categories[0]}] {${[...placeKinds(full)].join(',')}} ${(p.distanceMeters / 1609.34).toFixed(1)} mi`);
  }
}
