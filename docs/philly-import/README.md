# Philadelphia + Villanova import

Pulled 2026-10-03 from OpenStreetMap (Overpass) inside the shape in
`scripts/osm-import/regions.js`: the Main Line (Wayne, Radnor, Villanova, Bryn
Mawr, Haverford, Ardmore, Conshohocken) and Philadelphia's core (Manayunk to
Fishtown and South Philly's stadiums). Places inside the app's Villanova
viewbox join the `villanova` region; the rest join `philly`.

- Overpass: 4,668 elements (4,664 from the rules, 4 added by id for the
  insider places). Staged 2,728 + 6 insider places.
- Drops before selection: no name 1,771; not a listed kind 51; closed per OSM
  tags 20; chain department store 19; outside the shape 7; same place twice 26;
  already in the hand-picked catalog 42; by hand 10 (`overrides.json`: The Grog,
  the catalog's Grog Grill; mobile-market pickup points; exhibits and rides
  inside Adventure Aquarium and the Camden Children's Garden).
- Selection (`scripts/osm-import/select.js`, about 1,000): insider 6, every
  named bar/pub/beer garden/nightclub 257, Wikidata 158, culture 306, within
  3 km of Villanova and the Main Line towns 253, richest food and parks 20.
- Not selected: 1,722 (community gardens and pocket parks 155; chain branches
  107; old buildings with no heritage listing 33; practice fields 9; other
  kinds outside the tiers 115; food and parks below the fill line 1,303).

## Villanova insider places

Only places that exist in OSM, each with a source that ties it to Villanova
students (`overrides.json` `include`, with `why` and `source`):

| Place | Source |
| --- | --- |
| Up-Ryes Bagel, Bryn Mawr | The Villanovan, students' favorite brunch spots |
| First Watch, Villanova | The Villanovan, students' favorite brunch spots |
| La Colombe, Bryn Mawr | The Villanovan, best coffee shops near Villanova |
| Green Engine Cafe, Haverford | The Villanovan, best coffee shops near Villanova |
| Insomnia Cookies, Bryn Mawr | Bake Magazine, the branch down the street from Villanova |
| Winsor Trail | The Villanovan, students' hidden gems of 19085 |

Kelly's Taproom, The Grog Grill, Erin Pub, Campus Corner and Hope's Cookies
were already in the hand-picked Villanova catalog. Flip & Bailey's, McCloskey's,
Tiffin, Otto by Polpo, Jules Thin Crust, White Dog Cafe, The Silverspoon and
The Goat's Beard came in through the normal tiers. The Connelly Center Wawa
has no OSM node yet, so it is not on the map.

`<category>.json` here is each batch report from `build-packs.mjs`.

## Web research (in progress)

Batches 00-16 of 34 are researched (510 places: landmarks, culture, bars and
markets; food and parks are in batches 17-33). 485 matched, 811 facts kept
after `okWebFact`. 33 places dropped as closed for good, each with its
source in `overrides.json` (among them One Liberty Observation Deck, the
Bala and Anthony Wayne cinemas, SoundGarden Hall, Fluid, Finnigan's Wake and
the University of the Arts venues). Insider places carry facts from the pages
that tie them to Villanova.

## Photos (in progress)

`find-commons-photos.mjs` has looked up 340 of the places so far. The first
91 matches were reviewed by eye: 20 rejected (`overrides.json` rejectPhoto:
people, artifacts, signs, a ticket, wrong buildings), the rest applied.
