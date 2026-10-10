# Open work

Unfinished work and the decisions behind it, newest first. Remove an item in
the PR that finishes it.

## Malls (places with stores inside), Test tab only

The Test tab's "Malls" bubble (`screens/MallLab.jsx`) shows a map with only
the app's malls: every place with topic `mall` (imports) or `mall: true`
(hand-picked: Dolphin Mall, Brickell City Centre, Bayside Marketplace, King
of Prussia, Santana Row, V&A Waterfront, Galleria Vittorio Emanuele II), 18
in all. Tap one, Check in (no location needed in the lab), pick the stores
you went into (most visited first), then a thumbs card per store (4 max).
Palm Grove Plaza (`data/testMalls.js`) is the made-up example the six owner
checks run on (`lib/mallChecks.js`).

Store lists are app data (`data/mallStores.js`, built by
`scripts/build-mall-stores.mjs` from `scripts/osm-import/research/malls/`):
store names a result places at the mall, its directory as source, 1-2 tags.
`data/mallStores.test.js` fails when a mall has no stores (standing rule in
CLAUDE.md). Left open: 5 malls' research was still running (Midway Crossings, Sunset
Harbour Shops, Sunset Place, V&A Waterfront, Galleria Vittorio Emanuele II).
Two found no current tenants and need an owner call: Lincoln Center (690
Lincoln Road, likely a building on the Lincoln Road pedestrian mall, not a
mall: drop its mall topic?) and Ultramont Mall (only a 2015 source, saying a
tower would replace it: still open?). All seven sit in that test's
RESEARCH_PENDING list; checking in there skips the store question.

Scoring as before: a vote moves the store's tags with the Pick vote rules
(+4 / -6, half after 5, 90-day half-life, +/-100); mall score is the
thumbs-up share per rated store weighted by visits, unrated skipped;
itineraries take the mall when 2+ stores match the user's top 5 tags.
Ratings and the lab's taste stay in localStorage. Going live needs a
Firestore collection for store ratings, store tags in the real taste (every
Mapr surface through `src/lib/maprRank/`), visit counts from check-ins, the
store question after a real check-in at a mall, and `APP_HELP`.

## Key Biscayne import (address-located places)

The owner asked for 100 new Key Biscayne places (2026-10-09). Seven research
agents (`scripts/osm-import/research/kb/`, import region `kb`, packed into
Miami through `mergeFrom`) got 36 onto the map. OpenStreetMap had almost no
island businesses, so the owner allowed a place OSM lacks at its researched
street address when Nominatim returns that exact house number
(`addressFallback` in `regions.js`, ids `osm-kb-<name>`). Places in one plaza
share its address point (328 Crandon Blvd holds several). The island has few
more open places with sourced facts: the agents ran out of new restaurants,
cafes, bars and galleries. Parks, trails and bridges still need an OSM
object by name; seven leads failed that (`located.json`). Left open: no
Commons photos were searched for these places.

## Coral Gables and Key Biscayne merged into Miami

Both are now part of the `miami` region (`REGION_ALIASES` in
`src/data/regions.js`). Landmark ids did not change; their data still lives
in `landmarks.coralgables.js` and `landmarks.keybiscayne.js`, with
`region: 'miami'`. Old itineraries, check-ins, reviews, custom landmarks and
links that carry the old region id map to Miami on read (`getRegion`,
`getLandmark`, `canonicalRegionId`, trip load, leaderboard city stats, Mapr
nightly). Stored Firestore docs were not rewritten. Left open: the owner said
"any landmarks currently in South Florida" too, but no other South Florida
region exists, so nothing else moved. Other regions are untouched on request.

## Formula 1 Circuits hidden from category pickers

Owner asked to toggle "Formula 1 Circuits" off in the category pickers for now
(Landmarks tab dropdown, Add Landmark category, trip interests, taste chips;
the Map filter already hid it). The landmarks stay in the app. To bring the
category back, remove `'formula-1'` from `HIDDEN_INTEREST_IDS` in
`src/data/regions.js` (and from `HIDDEN_CATEGORIES` in
`src/components/MapCategoryFilter.jsx` for the map).

## Nightly scan 2026-10-07: 21 owner questions

`docs/landmark-hunters-scan-2026-10-07.md`, section 5, lists 21 changes that
need the owner's decision (Mapr chat exploration rate, offline maps, Book Now
links, streak rules, Firestore rules hardening, and others). Each has options
and a recommendation. Remove this item once they are answered.

## "Your places" onboarding step (test tab only)

Built in the admin Test tab (`OnboardingLab`): sign-up, then "Tell us up to
10 places you visit most" with autocomplete, then the cards. The step is the
shared component `src/components/OnboardingPlaces.jsx`. Given `uid` and
`profile`, Continue saves to the account by itself (`saveOnboardingPlaces`:
tagScores seed, `onboardingSwipeDeltas`, the text Mapr reads, and
`onboardingPlaces`), and `saveOnboardingResults` keeps those places when the
cards are saved later. Left open: render `<OnboardingPlaces uid profile places
onChange onDone />` in `screens/Onboarding.jsx`, keep `places` in the flow's
progress, and pre-fill it from `placesFromProfile(profile)`. Mapr needs no
further wiring.

Once a place is saved on the account (`profile.onboardingPlaces`) Mapr
treats it as a known love: 2x a swiped "love it" on every category tag
(`PLACE_DELTA`), never recommended back (`visitedReviewIds`, Travel Picks
exclusion), and the "Because you liked" anchor until a loved rating exists.

Owner asked that Mapr learn from every action from sign-up on. Today it
learns from ratings, pick votes, rating comments and the swipe cards only
(`src/lib/maprLearning.js`). Not yet learned from: the user's own check-ins
without a rating, itinerary adds, favorites, opens, directions taps, habit
visits. Needs the owner to pick which signals and their weights.

## Mapr v2 rollout (shipped at 100%, waiting on users)

The three NCF fixes and the signed `0.8 / 0.2` blend ship behind
`FEATURES.maprV2` at 100% on every Mapr surface (`docs/mapr-phase1.md`,
"Mapr v2 rollout"). Evidence so far is synthetic only
(`mapr-synthetic-trainer/SCALE-RESULTS.md`, `VALIDATION-RESULTS.md`: 60 of
60 runs won over tag + similarity). Left open:

- `NCF.autoEnableAboveUsers` is 0 while the owner tests with one other
  person, so the model ranks as soon as anyone has a check-in or loved
  rating. A model trained on two people mostly memorizes them: raise it
  back to 10 before real users arrive.
- The owner moved it from 20% to 100% while the app is just two testers,
  so the "Mapr v2 rollout" card has no control group. With real users,
  either lower `FEATURES.maprV2.rollout` to run an A/B test, or make
  `NCF_V2` the only model and remove v1 training.
- Pre-trained models gave brand-new users no lift over today's cold start,
  so `mapr-synthetic-trainer/deploy-to-production.js` has not been run and
  nothing reads `mapr_pretrained_*`.

## Admin dashboard setup (owner, once)

The dashboard reads Firestore on the server with `FIRESTORE_ADMIN_KEY` (a
live service-account key; no browser key, no Firebase sign-in). If it shows
"Can't connect to Firestore", the banner names the cause. The old key that
was committed to the repo is revoked; rotate any key that was ever in git.


The stats moved out of the app into `admin-dashboard/` (its own Vercel
project). Until the owner does the setup in `admin-dashboard/README.md`
(new Vercel project with Root Directory `admin-dashboard`, its env vars,
`ADMIN_JOBS_SECRET` + `DASHBOARD_URL` on the main app, publish
`firestore.rules`), there is no way to see the stats. Phase 2, not built:
Firebase Auth login instead of the shared password, date ranges, chart
annotations.

## Mapr Phase 1 follow-ups (shipped, waiting on users or the owner)

Phase 1 is live on every Mapr surface (`docs/mapr-phase1.md`). Left open:

- The spec's outcome targets (match rate 65% to 75%, A/B significance,
  retention) need real traffic. Watch the admin dashboard's Mapr Phase 1 page and the
  daily Slack message. Once there are enough users, lower a rollout below
  100 in `src/lib/maprRank/config.js` to run a real A/B test.
- Not built, needs an owner decision: the optional "preference reset" for
  stagnating users (drops the oldest 30% of ratings, so it deletes data).
- Dwell time is not tracked (the app records arrivals, not departures).

## Photos for imported places (started, not finished)

Share of places with a photo, on main as of 2026-10-05:

| Region | Places | With a photo |
| --- | --- | --- |
| Miami | 847 | 69 |
| Philly | 904 | 118 |
| Villanova | 13 | 0 |
| San Francisco | 336 | 64 |
| Silicon Valley | 118 | 23 |

Photos come from two places (details in `docs/photos.md`):

- Wikimedia Commons photos stored in the packs, found by
  `scripts/find-commons-photos.mjs` and reviewed by hand. A Commons photo
  needs a nearby geotag or the area named, and a reviewer rejects any photo
  that doesn't show the place.
- Google photos loaded live from `api/place-photo.js`: a 250 m radius and a
  strict name match, or no photo at all. Imported places (`source: 'osm'`)
  skip the Google lookup in dense lists (`LandmarkThumb` passes
  `lookup: false`) and get it only on the landmark page and nearby picks, to
  keep Google costs down.

Next steps to decide with the owner: run the Commons finder again for SF and
Silicon Valley, and choose whether imported places should get the Google
lookup in more places in the app, with a per-day cap.

## Thin categories in SF and Silicon Valley

SF has 3 history/culture places and Silicon Valley has 0. The SF import kept
only places with sourced facts and dropped neighborhood parks and branch
libraries in hand review. A second research pass on history spots
(landmarks, historic districts, museums of local history) would fill this.
Follow `docs/sf-import/README.md`.

## Size of SF and Silicon Valley

SF has 336 places and Silicon Valley 118, against Philly's 904. The research-
first method keeps only places it can source. More neighborhood and town
batches (`scripts/osm-import/research/sf/RESEARCH-PROMPT.md`) would grow both.
