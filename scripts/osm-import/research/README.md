# Web research for imported places

Miami: `batch-NN.json` here holds 30 places each (1,069 total), ordered
landmarks first, food last. `done.json` lists the place ids already researched
(all 1,069 as of 2026-10-03). Philadelphia + Villanova: the same files in
`philly/` (1,000 places, 34 batches). Facts from every region go into
`../web-facts.json`, keyed by place id. Skip ids in `done.json` when
re-running a batch.

Each batch runs as one agent with WebSearch only (page fetching is blocked in
the cloud environment). The session's web-search cap
(`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`, 200 by default) has to allow
about 1,200 more searches to finish.

## Agent instructions (per batch)

- Input: `batch-NN.json` (id, name, category, kind, address, city, lat/lng,
  website, knownFacts). Skip ids in `done.json`.
- At most 2 searches per place, name plus street, neighborhood or city.
- Confirm the result is this place (same name and street, neighborhood, park
  or campus); otherwise `matched: false`, no facts.
- `closed: true` plus `closedSource` when a result says it closed for good.
- 2 to 5 facts, each one plain sentence of at most 120 characters, each with
  the URL of the result that states it. Unsure which result states it: leave
  the fact out.
- Good facts: opening or build year, founder, designer, owner or operator,
  specialties, features (trails, courts, playground, dog park, boat ramp),
  size, history, notable events, what the name honors, named awards with year.
- Never: prices, hours, phone numbers, ratings, review counts, rankings,
  opinion words (best, famous, popular, iconic, favorite, must-visit),
  anything inferred or from memory. No em dashes.
- Source rule: WebSearch answers with a summary plus links. Keep a fact only
  when one link's title or snippet states it, the summary cites that link, or
  exactly one returned link is a page about this place. Never pick "the most
  likely" link among several. Several pages of one site count as several
  links. When the first search leaves fewer than 2 facts, run the second with
  `allowed_domains` set to one domain (the place's own site, or a news or
  official site whose result title is about this place) so that one page
  about the place can come back alone.
- Output `out-NN.json`: `[{id, name, matched, closed, closedSource,
  facts: [{text, url}]}]`.

Then review samples by hand, merge into `../web-facts.json` (keyed by id),
drop closed places through `../overrides.json`, and rebuild every category
with `node scripts/osm-import/build-packs.mjs <category>`.
(add `--region philly` for that import). `build-packs.mjs` filters facts again
with `okWebFact` (transform.js). Without the gitignored `data/<region>/` folder
it rebuilds from the current packs instead (web facts re-applied, photos kept,
`overrides.json` drops applied); each category keeps its place in
`placePacks.manifest.js`.

## Running an import region

    node scripts/osm-import/fetch-osm.mjs --region philly
    node scripts/osm-import/fetch-wikidata.mjs --region philly
    node scripts/osm-import/stage.mjs --region philly
    node scripts/find-commons-photos.mjs --region philly --places scripts/osm-import/data/philly/staged.json scripts/osm-import/data/philly/
    node scripts/osm-import/build-packs.mjs <category> --region philly

Regions, their shapes and which app region a place joins are in
`../regions.js`; which staged places a region keeps is `../select.js`.
`build-packs.mjs` takes photos from `data/<region>/commons.reviewed.json` when
it exists (the results looked at so far), else `commons.found.json`.
