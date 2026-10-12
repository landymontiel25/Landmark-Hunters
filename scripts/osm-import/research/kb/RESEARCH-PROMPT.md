# Place research: Key Biscayne and Virginia Key

Follow `scripts/osm-import/research/sf/RESEARCH-PROMPT.md` (area fill) with
these changes. Everything else there applies as written: WebSearch only,
OpenStreetMap check first, source rule, fact rules, no opinion words, no
prices or hours, awards only with their year, output format.

- Area: Key Biscayne (the village and the island's parks) and Virginia Key.
  Nothing on the mainland (no Brickell, no Coconut Grove).
- OSM check: `node scripts/osm-import/osm-check.mjs --region kb "Name"`.
- Local coverage to search: Islander News, Key Biscayne Independent, Miami
  Herald, Miami New Times, Eater Miami, The Infatuation Miami, Village of Key
  Biscayne pages, Miami-Dade Parks, Florida State Parks, the place's own site.
- Skip names in `scripts/osm-import/research/kb/catalog-names.json` (already
  in the app).
- `area`: "Key Biscayne" or "Virginia Key". `city`: "Key Biscayne" for
  places on Key Biscayne, "Miami" for Virginia Key.
- Kinds: restaurants, cafes, bakeries, bars, shops with a local history,
  parks, beaches, trails, marinas, nature centers, sports and outdoor
  activities (kayak or paddleboard outfitters, sailing clubs open to the
  public), historic sites, public art.

## Second round (address-located places)

OpenStreetMap has almost no Key Biscayne businesses, so the owner allowed a
place OSM lacks onto the map at its researched street address (Nominatim
must return that exact house number). For this round:

- Skip the OSM check. Research any open place in the area.
- Businesses need a street address with a house number from a result
  ("328 Crandon Blvd"); suite numbers are fine after it. No number: leave
  the place out unless it is a park or site OSM has mapped by name.
- Add `osmTag` to each entry, exactly one of: `amenity=restaurant`,
  `amenity=cafe`, `amenity=ice_cream`, `shop=bakery`, `amenity=bar`,
  `amenity=pub`, `shop=books`, `shop=art`, `shop=antiques`,
  `tourism=gallery`, `amenity=arts_centre`. Restaurants also get `cuisine`
  in one or two words when a result states it ("peruvian", "italian").
- Places of other kinds (parks, beaches, trails, marinas) still need to be in
  OSM by name: run the OSM check for those only.
