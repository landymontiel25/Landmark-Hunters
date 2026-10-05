# San Francisco and Silicon Valley import

Places in `public/places/san-francisco/` and `public/places/silicon-valley/`,
picked one by one from research rather than pulled in bulk (Overpass could
not be reached from the build environment). Counts, tiers and every drop by
reason are in `summary.json` (`node scripts/osm-import/research/summary.mjs`);
per-category samples are in the other JSON files here.

## How a place gets in

1. **Candidates** (`scripts/osm-import/research/<sf|sv>/`). Lists from
   published guides (Michelin, SF Chronicle, critics' bar, coffee and bakery
   guides, culture guides, tech-world spots) become name seeds
   (`lists/`, `build-seeds.mjs`); per-neighborhood and per-town batches add
   well-documented local places. Every batch follows
   `sf/RESEARCH-PROMPT.md`: confirm it is open at this address, 2 to 4 facts
   each with the URL that states it, no prices, hours, ratings or opinion
   words, awards only with their year.
2. **In OpenStreetMap at that address** (`locate-candidates.mjs`, rules in
   `locate.js`). Nominatim must return an object with the place's name AND
   the researched address: the object's own house number and street, within
   75 m of the geocoded address, or (parks, stairways, viewpoints with no
   house number) the researched street. Streams, roads and areas wider than
   3 km never match. No coordinate is typed by hand.
3. **Second pass** (`sf/VERIFY-PROMPT.md`, `build-verify.mjs`). A seeded 20%
   of the located places plus every place with an award fact were checked
   again by a separate agent. Facts it found wrong or unsupported, and places
   it found closed, stay out of every rerun.
4. **Selection** (`select.js` `selectCurated`). Everyday places need two
   sourced facts; award picks (a 2025 or 2026 award or list) and tech-world
   picks (a sourced reason) need one. Chains, hotels themselves, offices,
   members-only clubs, courts, pocket parks and branch libraries stay out.
5. **Hand review** (`overrides.json`): every staged place was read through;
   neighborhood parks with little for a visitor and branch libraries were
   dropped, and Commons photos that do not show the place were rejected.

## Reruns

    node scripts/osm-import/locate-candidates.mjs --region sf   # cached Nominatim replies in data/sf/nominatim
    node scripts/osm-import/fetch-wikidata.mjs --region sf
    node scripts/osm-import/stage.mjs --region sf
    node scripts/find-commons-photos.mjs --region sf --places scripts/osm-import/data/sf/staged.json scripts/osm-import/data/sf/
    node scripts/osm-import/build-packs.mjs <category> --region sf

Research agents check a name against OpenStreetMap before searching the web:
`node scripts/osm-import/osm-check.mjs --region sf "Name"` (shares the
cache and the one-request-a-second limit with the locator).
