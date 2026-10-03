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
