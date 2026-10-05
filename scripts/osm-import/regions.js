// The import regions. Each one pulls one shape from Overpass into
// scripts/osm-import/data/<id>/ (gitignored), writes its packs to
// public/places/<pack region>/ and its batch reports to docs/<id>-import/.
// `packRegionOf` says which app region (src/data/regions.js) a place joins.
import { MIAMI_SHAPE, insideShape } from './transform.js';

// Main Line (Wayne, Radnor, Villanova, Bryn Mawr, Haverford, Ardmore,
// Conshohocken) and Philadelphia's core (Manayunk, East Falls, University
// City, Center City, Old City, Northern Liberties, Fishtown, South Philly to
// the stadiums), clockwise from the northwest.
export const PHILLY_SHAPE = [
  [40.075, -75.43],
  [40.095, -75.33],
  [40.075, -75.27],
  [40.045, -75.2],
  [40.02, -75.16],
  [40.0, -75.115],
  [39.975, -75.105],
  [39.93, -75.13],
  [39.895, -75.135],
  [39.895, -75.2],
  [39.935, -75.235],
  [39.975, -75.28],
  [40.0, -75.33],
  [40.03, -75.41],
];

// The app's Villanova region viewbox (src/data/regions.js).
export const VILLANOVA_BOX = { minLat: 40.025, minLng: -75.355, maxLat: 40.048, maxLng: -75.33 };
export const inVillanovaBox = (lat, lng) =>
  lat >= VILLANOVA_BOX.minLat && lat <= VILLANOVA_BOX.maxLat && lng >= VILLANOVA_BOX.minLng && lng <= VILLANOVA_BOX.maxLng;

// San Francisco city proper, clockwise from Point Lobos: the north shore past
// Baker Beach, the Golden Gate Bridge, Crissy Field, the Marina and Fort
// Mason, Fisherman's Wharf and Pier 39, the Embarcadero piers, Mission Bay,
// Pier 70, Hunters Point, Candlestick, then west along the San Mateo county
// line (37.708) to Fort Funston and north up Ocean Beach. Each edge follows
// the shoreline closely enough to keep the piers in and open water out;
// Alcatraz, Treasure Island and the Farallones stay out.
export const SF_SHAPE = [
  [37.778, -122.5155],
  [37.7835, -122.5145],
  [37.7885, -122.5055],
  [37.7905, -122.4865],
  [37.8115, -122.4795],
  [37.8115, -122.474],
  [37.8065, -122.455],
  [37.8085, -122.43],
  [37.8115, -122.42],
  [37.8115, -122.408],
  [37.806, -122.4],
  [37.8035, -122.395],
  [37.797, -122.389],
  [37.787, -122.383],
  [37.77, -122.382],
  [37.755, -122.376],
  [37.74, -122.37],
  [37.728, -122.355],
  [37.718, -122.36],
  [37.708, -122.378],
  [37.7081, -122.503],
  [37.735, -122.509],
  [37.76, -122.512],
];

// Neighborhood centers, for spreading the restaurant/cafe/park fill across
// the city (select.js `spread`): each place counts toward the nearest one.
export const SF_NEIGHBORHOODS = [
  ['Mission', 37.7599, -122.4148],
  ['North Beach', 37.8061, -122.4103],
  ['Chinatown', 37.7941, -122.4078],
  ['SoMa', 37.7785, -122.4056],
  ['Hayes Valley', 37.7759, -122.4245],
  ['Castro', 37.7609, -122.435],
  ['Haight-Ashbury', 37.7692, -122.4481],
  ['Inner Richmond', 37.7802, -122.4644],
  ['Outer Richmond', 37.7775, -122.495],
  ['Inner Sunset', 37.7602, -122.4683],
  ['Outer Sunset', 37.755, -122.494],
  ['Parkside', 37.74, -122.49],
  ['Marina', 37.8037, -122.4368],
  ['Cow Hollow', 37.7975, -122.435],
  ['Nob Hill', 37.793, -122.4161],
  ['Russian Hill', 37.8011, -122.4194],
  ['Fisherman\'s Wharf', 37.808, -122.4177],
  ['Financial District', 37.7946, -122.3999],
  ['Union Square', 37.788, -122.4075],
  ['Tenderloin', 37.7847, -122.4141],
  ['Pacific Heights', 37.7925, -122.4382],
  ['Japantown', 37.7854, -122.4294],
  ['Western Addition', 37.7814, -122.433],
  ['Lower Haight', 37.774, -122.438],
  ['Laurel Heights', 37.786, -122.45],
  ['Presidio', 37.7989, -122.4662],
  ['Sea Cliff', 37.785, -122.495],
  ['Golden Gate Park', 37.7694, -122.4862],
  ['Noe Valley', 37.7502, -122.4337],
  ['Twin Peaks', 37.748, -122.443],
  ['Glen Park', 37.734, -122.433],
  ['Bernal Heights', 37.7389, -122.4152],
  ['Potrero Hill', 37.7605, -122.4009],
  ['Dogpatch', 37.7609, -122.388],
  ['Mission Bay', 37.7706, -122.3915],
  ['Bayview', 37.729, -122.3925],
  ['Excelsior', 37.7244, -122.4268],
  ['Visitacion Valley', 37.713, -122.408],
  ['Ingleside', 37.721, -122.456],
  ['West Portal', 37.7405, -122.4663],
  ['Lake Merced', 37.72, -122.49],
];

export const IMPORT_REGIONS = {
  miami: {
    shape: MIAMI_SHAPE,
    packRegions: ['miami'],
    packRegionOf: () => 'miami',
    // Commons photos of imported places must also be shown to be in the area.
    area: /\b(miami|coral gables|key biscayne|coconut grove|little havana|wynwood|brickell|south beach|virginia key|pinecrest|doral|hialeah|westchester|kendall|sweetwater|dade|biscayne)\b/,
  },
  philly: {
    shape: PHILLY_SHAPE,
    packRegions: ['philly', 'villanova'],
    packRegionOf: (lat, lng) => (inVillanovaBox(lat, lng) ? 'villanova' : 'philly'),
    // About 1,000 of the ~2,700 staged places (select.js): everything within
    // 3 km of Villanova's campus and the Main Line towns counts.
    select: {
      target: 1000,
      anchorMeters: 3000,
      anchors: [
        [40.0375, -75.3425], // Villanova University
        [40.044, -75.3877], // Wayne
        [40.0462, -75.3599], // Radnor
        [40.0287, -75.3262], // Rosemont
        [40.0218, -75.3163], // Bryn Mawr
        [40.011, -75.2996], // Haverford
        [40.0084, -75.2885], // Ardmore
        [40.0793, -75.3016], // Conshohocken
      ],
    },
    area: /\b(philadelphia|philly|villanova|radnor|wayne|rosemont|bryn mawr|haverford|ardmore|narberth|wynnewood|merion|conshohocken|manayunk|roxborough|east falls|fishtown|kensington|northern liberties|old city|society hill|center city|rittenhouse|fairmount|university city|south philly|passyunk|delaware county|montgomery county|main line)\b/,
  },
  'san-francisco': {
    shape: SF_SHAPE,
    packRegions: ['san-francisco'],
    packRegionOf: () => 'san-francisco',
    // Parks count from 0.6 acres (measured on their outline), Wikidata or not;
    // San Francisco gives many mini parks and plazas a Wikidata item.
    select: { target: 1300, neighborhoods: SF_NEIGHBORHOODS, minParkAcres: 0.6 },
    area: /\b(san francisco|sf|presidio|golden gate|mission district|north beach|chinatown|soma|hayes valley|castro|haight|richmond district|sunset district|marina|nob hill|russian hill|dogpatch|embarcadero|fisherman's wharf|tenderloin|bernal heights|noe valley|potrero|pacific heights|japantown|lands end|ocean beach|twin peaks|union square)\b/,
  },
};

export function importRegion(id) {
  const r = IMPORT_REGIONS[id];
  if (!r) throw new Error(`unknown import region ${id} (have ${Object.keys(IMPORT_REGIONS).join(', ')})`);
  return { id, dataDir: `scripts/osm-import/data/${id}`, docsDir: `docs/${id}-import`, ...r };
}

// `--region <id>` from the command line (default miami), removed from argv.
export function regionFromArgs(argv) {
  const i = argv.indexOf('--region');
  const id = i >= 0 ? argv.splice(i, 2)[1] : 'miami';
  return importRegion(id);
}

export const insideRegion = (region, lat, lng) => insideShape(lat, lng, region.shape);
