# San Francisco import: research status and next steps

## Pipeline (region `san-francisco`)

    node scripts/osm-import/fetch-osm.mjs --region san-francisco --split   # one query per kind, bounding box
    node scripts/osm-import/fetch-osm.mjs --region san-francisco --areas   # park/garden/beach/zoo outlines
    node scripts/osm-import/fetch-wikidata.mjs --region san-francisco
    node scripts/osm-import/stage.mjs --region san-francisco               # 1,300 staged (select.js, regions.js)
    node scripts/osm-import/research/sf/check-locations.mjs                # city boundary + coastline + piers

The selection rule is in `../../select.js` and `../../regions.js`. It keeps
every named bar, pub, club and music venue, every Wikidata place, the
culture places (museums, galleries, theaters, cinemas, historic sites,
viewpoints, markets, bookstores), and parks, gardens and beaches of at least
0.6 acres measured on their outline. A park, viewpoint or attraction inside
a smaller selected place (a zoo exhibit, a bed of the botanical garden)
counts as part of that place. The neighborhood-spread food fill tops the set
up to 1,300. `review-1.json` and `review-2.json` hold the hand review (drops
and category fixes), applied to `../../overrides.json` with
`apply-review.mjs`.

## Research (PROMPT.md, one Sonnet agent per 25-place batch)

`out-00` to `out-45` are done, except that batches 42 to 45 stopped partway.
On 2026-10-05 the session's WebSearch cap (2,500) ran out. `done.json` lists
the 1,045 places researched with a result (facts, closed or not found).
`batch-52` to `batch-62` (255 places) hold the rest: 188 never searched
(mostly restaurants and cafes) and 67 matched with no fact yet. Run them in
a new session, then:

1. `node scripts/osm-import/research/sf/merge-sf.mjs` merges facts into
   `../../web-facts.json`, and drops closed and not-found places through
   `../../overrides.json`.
2. Re-check every closure in a fresh search; write `verify-closed.json`
   (`[{id, closure: 'open' | 'closed', url}]`). An `open` verdict overturns
   the closure in the merge.
3. Second verification pass: a separate agent re-checks a random 20% of the
   facts (at least 40 per category) and writes `verify-NN.json`
   (`[{id, text, verdict: 'ok' | 'fail', url}]`). The merge removes failed
   facts. Re-research a category whose sample fails more than 10%.
4. Rebuild the packs (`build-packs.mjs <category> --region san-francisco`),
   then run `../thin/select-thin.mjs` (it covers san-francisco). It must find
   0 thin places.
5. Run `liked-check.mjs` for the 15 "Because you liked" checks.
