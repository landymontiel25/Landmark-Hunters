# Outside ratings (Google, Tripadvisor)

Landmark cards and landmark pages show each place's Google Maps and
Tripadvisor rating, review count, a link to the source's page, and (on the
landmark page) up to 2 short review quotes per source. A third row for the
app's own Landmark Hunters rating is built and switched off.

## Pieces

| Piece | File |
| --- | --- |
| Sources, switches, shared helpers | `src/lib/ratingSources.js` (`RATINGS_FLAGS`) |
| Per-landmark IDs | `src/data/ratingSourceIds.json`, keyed `region/id`: `{ googlePlaceId, tripadvisorLocationId }` |
| Filling the IDs | `scripts/match-rating-sources.mjs` (matching rules in `scripts/rating-sources/match.js`) |
| Endpoint | `api/landmark-ratings.js` (fetchers in `api/_lib/ratingSources.js`) |
| Client | `src/lib/landmarkRatings.js`, `src/lib/useLandmarkRatings.js` |
| UI | `src/components/ratings/` (`RatingsCardLine` in each Places tab row's tag line: "⭐ 4.6 (1,234) Google Maps" in place of the old 🔥 N/10 tag, falling back to the app's own average when Google has none; `RatingsSection` on the landmark page) |

The IDs live in one map instead of inside each landmark's own data: 2,253
of the 3,498 places sit in generated, content-hashed pack files
(`public/places/`), and editing them would change every pack's hash and the
manifest. The map is read only by the server, so the app download doesn't
grow. Each entry is still the two optional fields per landmark.

## Switches (`RATINGS_FLAGS` in `src/lib/ratingSources.js`)

- `cardLine: true`. The line on each Landmarks tab card. Turn it off if the
  billing report climbs (see Cost).
- `landmarkHunters: false`. The Landmark Hunters row on the landmark page
  (the `landmark_ratings` average already shown under the name). Set to
  `true` to show it.

## What the terms allow (checked 2026-10-13)

- **Google** ([Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies),
  [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)):
  no caching or storing of Places content except the place ID, which may be
  stored indefinitely (coordinates up to 30 days, not used here). When shown
  without a Google map: "Google Maps" attribution (text is fine where the
  logo doesn't fit; the app shows the logo once `public/brand/` has it, and
the text until then), Google content set apart from other content. The
wording "Google Maps" can't be changed (no "Google reviews"). Reviews:
  author name, photo and profile link; a link to each review on Google Maps
  (`googleMapsUri`); a note on how reviews are ordered; visit month and year
  for places in France. Places content must not be used with a non-Google
  map, so these ratings stay off the Map tab.
- **Tripadvisor** (Terra docs: [Caching Policy](https://docs.terra.tripadvisor.com/docs/caching-policy.md),
  [Review Implementation Policy](https://docs.terra.tripadvisor.com/docs/review-implementation-policy.md),
  legacy [Display Requirements](https://tripadvisor-content-api.readme.io/reference/display-requirements)):
  no caching of any content except the location ID. The Ollie logo (20 px
  tall or more) to the left of the bubble rating Tripadvisor sends, bubbles
  on white, a link back. Quotes only from 5-bubble reviews, only when the
  place is rated 4 or more, in quotation marks, with the date and "Tripadvisor
  traveler". Review text must load through a call crawlers can't fetch:
  `public/robots.txt` disallows `/api/landmark-ratings`. The legacy Content API
  is deprecated; this uses Terra (`terra.tripadvisor.com/api`, `X-API-Key`),
  which only answers for locations on the account's allowlist.
- **Yelp** ([API Terms, 2026-09-22](https://terms.yelp.com/developers/api_terms/)):
  not built. Section 5(c) forbids showing Yelp ratings "alongside or in
  conjunction with other user-generated content", which every place these
  ratings appear (Google, Tripadvisor and the app's own ratings and comments)
  would do. It would need Yelp's written permission.

So nothing is cached in Firestore or anywhere else: each request fetches
fresh, and the client only shares a request that is already in flight. The
endpoint answers `Cache-Control: no-store`.

## Endpoint

`GET /api/landmark-ratings?region=&id=[&detail=1]` (signed in; 150 calls per
account per 10 minutes, through `api/_lib/aiGuard.js` like the AI endpoints).
Answers `{ landmarkId, detail, sources: { google, tripadvisor }, googleNoRating }`;
each source is `{ rating, count, url, ratingImageUrl?, snippets }` or `null`
(no ID, no key, no rating, or the source failed). `googleNoRating` is true
only when the null is final (no Google ID for the place, or Google answered
with no rating); a failed lookup leaves it false. The app shows "No ratings
available" only on true. The request never fails because a source did. Keys (`GOOGLE_PLACES_API_KEY`, `TRIPADVISOR_API_KEY`) are read
only on the server.

- Card (`detail` off): Google Place Details with `rating,userRatingCount,googleMapsUri`;
  Terra Location Details.
- Landmark page (`detail=1`): the same plus Google `reviews` and Terra
  Location Reviews (`rating_min=5`).

## User-added landmarks

A landmark someone adds (`custom_landmarks`, id `custom-...`) has no entry
in `ratingSourceIds.json`. The first time the endpoint is asked about one,
`api/_lib/customRatingMatch.js` runs one Google Text Search (name, 250 m
bias), applies the script's strict match (`api/_lib/ratingMatch.js`), and
saves only `googlePlaceId` (plus `googleMatchAt`) on the landmark's doc with
the admin SDK. No sure match: only `googleMatchAt` is saved and the search
runs again after 14 days. Clients can't write either field (the
`custom_landmarks` create rule pins its keys).

## Filling the IDs

```
GOOGLE_PLACES_API_KEY=... TRIPADVISOR_API_KEY=... \
  node scripts/match-rating-sources.mjs --region=philly --batch=20 --limit=40
```

Start with `--dry-run` (no calls; prints how many it would make), then
`--batch=1 --limit=1` to check both APIs answer. It writes after every batch
and resumes where it stopped. A landmark counts as matched only when exactly
one result passes the strict name test (`namesMatch`, the one place photos
use) within 150 m (400 m for parks, campuses and other large places). Close
but uncertain results go to `scripts/rating-sources/review.json` with the top
candidates; nothing near goes to `no-match.json`. Move a reviewed ID into
`src/data/ratingSourceIds.json` by hand. Add the IDs in
`scripts/rating-sources/tripadvisor-allowlist.txt` to the Terra allowlist.

Unconfirmed: the Terra Catalog nearby search's parameter names
(`latitude`, `longitude`, `radius`, `unit`) could not be read from Tripadvisor's
reference page. If the first `--limit=1` run logs a 400, fix `terraNearbyUrl`.

## Cost

Every call bills, because nothing may be cached. Google's rating and review
count are Place Details Enterprise fields, and reviews add the Atmosphere
tier; matching uses Text Search Pro (one call per landmark, once). Check
current prices on Google's pricing page and Terra's usage-based pricing.
A full match run is 3,498 Google and 3,498 Tripadvisor calls. After that,
each card that scrolls into view is one call per source, and each landmark
page another. Watch the first billing report; `RATINGS_FLAGS.cardLine` is the
lever.

Brand asset needed: `public/brand/tripadvisor-logo.svg` (see
`public/brand/README.md`). Tripadvisor rows stay hidden until it exists.
