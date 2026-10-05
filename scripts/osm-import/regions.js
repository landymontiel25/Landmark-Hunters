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

// San Francisco city proper, mainland only (no Treasure Island or the
// Farallones), clockwise from Point Lobos. The line runs a little offshore
// so piers and beachfront places count; the south edge is the San Mateo
// County line along Geneva Avenue (37.708).
export const SF_SHAPE = [
  [37.7905, -122.5135],
  [37.79, -122.4995],
  [37.7895, -122.487],
  [37.799, -122.485],
  [37.8115, -122.479],
  [37.8085, -122.46],
  [37.809, -122.444],
  [37.811, -122.431],
  [37.8105, -122.423],
  [37.8115, -122.41],
  [37.8085, -122.402],
  [37.804, -122.399],
  [37.7975, -122.3915],
  [37.787, -122.3855],
  [37.778, -122.384],
  [37.765, -122.385],
  [37.755, -122.38],
  [37.744, -122.378],
  [37.735, -122.362],
  [37.729, -122.354],
  [37.721, -122.354],
  [37.715, -122.365],
  [37.71, -122.378],
  [37.7081, -122.388],
  [37.7081, -122.503],
  [37.72, -122.505],
  [37.735, -122.508],
  [37.76, -122.512],
  [37.78, -122.515],
];

// Neighborhood centers in San Francisco. A place counts toward its nearest
// center when the selection spreads the fill across the city (select.js);
// the label is only for that spread and the import report.
export const SF_NEIGHBORHOODS = {
  Mission: [37.7599, -122.4148],
  'North Beach': [37.8061, -122.4103],
  Chinatown: [37.7941, -122.4078],
  SoMa: [37.7785, -122.4056],
  'Hayes Valley': [37.7759, -122.4245],
  Castro: [37.7609, -122.435],
  Haight: [37.7692, -122.4481],
  'Inner Richmond': [37.7802, -122.4645],
  'Outer Richmond': [37.7777, -122.4935],
  'Inner Sunset': [37.7602, -122.4675],
  'Outer Sunset': [37.7553, -122.4945],
  Marina: [37.803, -122.437],
  'Pacific Heights': [37.7925, -122.4382],
  'Nob Hill': [37.793, -122.4161],
  'Russian Hill': [37.8011, -122.4194],
  Dogpatch: [37.7576, -122.3889],
  'Jackson Square': [37.7967, -122.4027],
  Presidio: [37.7989, -122.4662],
  'Financial District': [37.7925, -122.3985],
  'Union Square': [37.788, -122.4075],
  Tenderloin: [37.784, -122.414],
  'Noe Valley': [37.7502, -122.4337],
  'Bernal Heights': [37.7389, -122.4153],
  'Potrero Hill': [37.7605, -122.4009],
  Japantown: [37.7854, -122.4294],
  "Fisherman's Wharf": [37.808, -122.4177],
  'Mission Bay': [37.7706, -122.3915],
  'Glen Park': [37.734, -122.4337],
  NoPa: [37.7781, -122.4389],
  Bayview: [37.7298, -122.3925],
  Excelsior: [37.7235, -122.4269],
  'Lake Merced': [37.7246, -122.4851],
};

export const nearestNeighborhood = (lat, lng, centers = SF_NEIGHBORHOODS) =>
  Object.entries(centers).reduce((best, [name, [a, b]]) => {
    const d = (lat - a) ** 2 + ((lng - b) * Math.cos((lat * Math.PI) / 180)) ** 2;
    return d < best.d ? { name, d } : best;
  }, { name: null, d: Infinity }).name;

// Silicon Valley: these towns' own city limits (OpenStreetMap admin_level 8
// boundaries, pulled one by one with an Overpass area query), plus downtown
// San Jose. Nothing else in the app region's viewbox comes in.
export const SV_TOWNS = ['Palo Alto', 'Menlo Park', 'Atherton', 'Woodside', 'Portola Valley', 'Los Altos', 'Mountain View', 'Sunnyvale', 'Cupertino', 'Santa Clara'];
// Downtown San Jose: Julian Street to Interstate 280, Highway 87 and the
// Guadalupe River to 4th/10th Street (SoFA and San Pedro Square included).
export const SJ_DOWNTOWN_SHAPE = [
  [37.3445, -121.9005],
  [37.3445, -121.889],
  [37.3395, -121.8805],
  [37.3315, -121.8775],
  [37.3255, -121.8835],
  [37.3255, -121.8925],
  [37.3315, -121.9025],
];
// The app's silicon-valley viewbox (src/data/regions.js), the outer bound.
export const SV_BOX = [
  [37.7, -122.55],
  [37.7, -121.6],
  [37.15, -121.6],
  [37.15, -122.55],
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
  sf: {
    shape: SF_SHAPE,
    packRegions: ['san-francisco'],
    packRegionOf: () => 'san-francisco',
    areaOf: (lat, lng) => nearestNeighborhood(lat, lng),
    // Curated for people who live and work in the city (select.js
    // selectCurated): researched picks first, then Wikidata places, culture
    // and the best-documented bars and food, spread across neighborhoods.
    curated: { target: 1000, nightlifeShare: 0.16, minFillScore: 3, minCultureScore: 2, minWebFacts: 2 },
    area: /\b(san francisco|sf|mission district|north beach|chinatown|soma|hayes valley|castro|haight|richmond district|sunset district|marina|pacific heights|nob hill|russian hill|dogpatch|jackson square|presidio|golden gate park|embarcadero|fisherman's wharf|noe valley|bernal heights|potrero hill|japantown|mission bay)\b/,
  },
  sv: {
    shape: SV_BOX,
    // One Overpass pull per town (its admin boundary) plus downtown San Jose;
    // every pulled element carries the name of the part it came from.
    parts: [...SV_TOWNS.map((name) => ({ name, town: name })), { name: 'Downtown San Jose', shape: SJ_DOWNTOWN_SHAPE }],
    packRegions: ['silicon-valley'],
    packRegionOf: () => 'silicon-valley',
    curated: { target: 400, nightlifeShare: 0.14, minFillScore: 3, minCultureScore: 2, minWebFacts: 2 },
    area: /\b(palo alto|menlo park|atherton|woodside|portola valley|los altos|mountain view|sunnyvale|cupertino|santa clara|san jose|stanford|silicon valley)\b/,
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
