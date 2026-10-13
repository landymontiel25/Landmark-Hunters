# Open work

Unfinished work and the decisions behind it, newest first. Remove an item in
the PR that finishes it.

## Google map online, Esri offline (2026-10-13, needs the owner's key)

The Map tab shows Google's satellite map with labels (Map Tiles API) while
online and keeps the Esri/Carto map and offline download when offline, with
no key set, or when Google tiles fail. Map popups show the Google rating
only on Google's map (Places terms). Nothing changes until the owner
enables the Map Tiles API, makes a browser key restricted to it and the
site's referrers, sets a daily tile quota, and adds
`VITE_GOOGLE_MAP_TILES_KEY` in Vercel. Details: `docs/google-map.md`.

## Google and Tripadvisor ratings on landmarks (2026-10-13, needs owner steps)

Update 2026-10-13: Google matching ran for all 3,498 places: 2,327 matched
(src/data/ratingSourceIds.json), 735 close calls in
scripts/rating-sources/review.json, 436 with nothing near in no-match.json.
Owner to-dos: set Places quotas back (SearchTextRequest 400,
SearchNearbyRequest 100, GetPlaceRequest 1000), add a budget alert, and
regenerate the Places key (it appeared in a screenshot) and update Vercel.

Built in PR "Landmark ratings" (not merged, per the owner): `docs/ratings.md`.
Cards and landmark pages show Google and Tripadvisor ratings through
`api/landmark-ratings.js`; a Landmark Hunters row is built behind
`RATINGS_FLAGS.landmarkHunters` (off). Nothing shows until the owner:
adds `TRIPADVISOR_API_KEY` (Terra) in Vercel, runs
`scripts/match-rating-sources.mjs` (this cloud session had no keys; the
Terra nearby parameter names are unconfirmed), reviews
`scripts/rating-sources/review.json`, adds the Tripadvisor IDs to the Terra
allowlist, and drops Tripadvisor's logo into `public/brand/`. No ratings are
cached anywhere, because Google and Tripadvisor terms allow storing only
their IDs. Yelp was asked for and not built: Yelp's API terms 5(c) forbid
its ratings beside other user content. Watch billing after launch;
`RATINGS_FLAGS.cardLine` turns off the per-card calls.

## Discovery network plan v2 (in progress)

`docs/discovery-network-plan.md` (v2, 2026-10-10) turns Mapr from ranking
places into matching people: verified presence, tips, follows and taste
neighbors, community picks on every Mapr surface, local reputation, alerts,
then a feed in dense cities. v2 adds a per-city ramp (Mapr only until a city
has 100 active users and 150 live tips), a 0.3 neighbor-score floor, a radius
and accuracy table by place type, a reputation cap of 15 per person, and moves
check-in read limits before Phase 2. Order of work: prerequisites (rules tests
in CI, scan question 7, check-in and points parts of question 14), then
Phase 0. Update this item as each step ships.

Progress: the `rules` CI job runs `scripts/rules-test.mjs` in the Firebase
emulator on every PR (`npm run test:rules`), and the rules deploy workflow
runs it again before it deploys. `isAdmin()` in both rules files now needs a
verified email (scan question 7); Google sign-in is always verified. Check-in
points pay once per account: a paying check-in must create
`checkin_payouts/{uid}` in the same write, and a leaderboard entry rises only
by a payout made in the same write (the paying check-in it names in
`lastCheckinId`, or a matching bonusPoints rise). App builds from before this
change fail any check-in that pays points; install a fresh iOS build. Left
open from question 14: one payout can still be copied into other weeks' and
years' entries (at most once per entry), and `region_stats` bumps.

Phase 0 (verified presence) shipped: `api/verify-checkin.js` checks a fresh
GPS fix after each check-in against the place (`src/lib/presence.js`: radius
and accuracy by place type, 10-minute check-in age, 2-minute fix age, 900
km/h travel limit) and writes `presence`; the rules forbid clients from
writing it or `verification: 'verified'`. The fix goes to server-only
`checkins/{id}/proof/main`, the last verified fix to `presence_state/{uid}`.
"✓ Verified visit" shows on the check-in screen and in the check-in list.
The nightly job writes `presence_metrics/{date}`; the dashboard's App metrics
page shows the rate (goal 80%). Next: a week on real phones to tune the
radius table (the type table replaces each place's own
`checkInRadiusMeters` for verification; big museums like the Philadelphia
Museum of Art, 500 m today, may need their own number), then Phase 1. Left
open in Phase 0: the Android mock-location flag (needs a native plugin
change; the server already rejects `mocked: true`), Firebase App Check, an
offline retry queue (an offline check-in stays unverified), the legacy
`distanceMeters` / `gpsAccuracyMeters` keys still accepted on check-in create
for pre-Phase-0 builds (remove with the Phase 2 read limits), and proof docs
left behind when an account is deleted.

Phase 1 (tips) in progress, owner asked 2026-10-13 to build Phases 1 to 6
without the week of phone tuning or the 50-tip checkpoint. Shipped so far:
the rules. `tips/{uid}_{landmarkId}` (one tip per person per place) is
written only by the server. Clients read only their own tips (and the
admin any): everyone else's come from `api/tips.js`, which hides blocks
both ways and sends no report count, exact post time or held reasons
(stricter than the plan's read rule). Reports go through the server too, stricter than the
plan's "add your own uid to the report list". `tip_reactions` are owner
reads, server writes; `tip_views` server-only. `recommendation_log` takes
the `'landmark-page'` surface. Storage `tip_photos/{uid}/` takes the owner's
images under 5 MB. `firestore.indexes.json` is new and deploys last in the
rules workflow (the service account may need the Cloud Datastore Index
Admin role). Endpoints shipped: `api/post-tip.js` (share, delete your own,
`delete-mine` on account deletion, which `accountDeletion.js` calls) and
`api/tips.js` (a place's live tips with blocks hidden both ways, helpful
and saved, reports; marking and reporting need a verified email, like
posting; reading doesn't). Each tip is recorded as seen when it reaches the
screen (`seen`, verified accounts only): a `tip_views` doc and one
`recommendation_log` impression row (surface `landmark-page`, the newly
seen `tipIds`), both written by the server under one rule. Reporters
live in server-only `tip_reports/{tipId}_{gen}_{uid}` (no rule
matches it, so clients are denied), never on the tip. The 10-an-hour count
lives in server-only `tip_post_log/{uid}`, so deleting doesn't reset it;
`tip_photo_claims/` keeps one photo to one tip, and the photo must already
be uploaded. Each post of a tip has its own `gen`; marks, reports and views
carry it, so leftovers from an earlier post at the same id never count. A
tip hidden by reports that its author deletes is withdrawn (status `withdrawn`): hidden
from everyone, kept with its reports for the owner's review, and no new tip
there until the owner clears it. An unreported one (live, or held by the
filter) is deleted. Tip photos can't be overwritten in Storage, so a
reviewed tip's photo can't be swapped, and one photo can sit on one tip
only; account deletion retires each tip as a
delete would (a removed or reported tip stays hidden, with its text and
photo, for the owner's review; the owner deletes it from the Content
page), clears the rest of `tip_photos/{uid}/`, and keeps the person's
reports and post log, so `delete-mine` on a live account can't lift a
moderation lock or reset a limit. `discard-photo` removes an upload whose
tip never posted (clients can't delete tip photos). Tips keep only
the visit month, in the place's time zone, and not the check-in id (the tip
doc is readable by anyone who sees the tip). If `delete-mine`
fails twice, account deletion stops before wiping anything and says so
(unless the account provably has no tips or marks).  The word filter
(`src/lib/tipFilter.js`) holds a tip instead of refusing it. `tip_views` feed the Phase 4 "went" count. Photos on tips need
`VITE_FIREBASE_STORAGE_BUCKET` in the server's environment too (Vercel
gives functions every project variable); without it every photo is
refused.
UI shipped: the check-in screen offers "Share a tip for others?" after a
verified visit (`components/tips/TipComposer.jsx`), and landmark pages show
"From people who went" under the facts (`components/tips/TipsSection.jsx`)
with Helpful, Save, Report (with a reason) and Block, your own tip's
status, and "Share a tip for others" for 30 days after a verified visit.
`statsData.js` keeps the `landmark-page` rows out of every Mapr metric
(`tipImpressions`). A tip you reported stays hidden for you. Open choice:
impressions sit in `recommendation_log` as the plan says, so they count
toward its 100,000-row nightly read cap; move them to their own
collection if that cap gets close. Photos the browser can't convert
(HEIC on most desktops) are refused rather than posted broken. Legal explains tips and how to
report one; APP_HELP describes tips. The dashboard's Content page
(admin-dashboard, Content) lists held, reported and withdrawn tips with
the filter's reasons and the report reasons (never who reported); Approve,
Remove and Delete go through `api/admin-jobs.js` (`tips-queue`,
`tip-moderate`, `api/_lib/tipModeration.js`). Approving resets the report
count (resolved reports stay as the record). The nightly job writes
`tip_metrics/{date}` (tips by state, posted, impressions, people with a
live tip in 30 days, live tips per region) and sweeps marks and views
whose tip is gone or reposted (`sweepTipOrphans`: reads the tips at sweep
time, skips the last hour, walks 2,000 docs a night from a cursor in
server-only `tip_sweep_state`). A decision applies only to the post the
owner saw (its `gen`); Remove and Delete ask first. The reported queue
uses a new `tips (status, reportCount)` index. Phase 1 is complete; the 50-tip checkpoint is
skipped at the owner's request.

## Live location on group trips: updates only while the app is open (2026-10-13)

`group_trips/{id}/live_locations/{uid}` (rules + emulator tests in
`scripts/rules-test.mjs`). Timed shares (15 min / 1 h / 8 h) are pushed by
`LiveLocationSharer` (mounted app-wide) and page-only shares by
`LiveLocationCard` with a 2-minute heartbeat. A web page can't send
location in the background, so with the app closed a share freezes at its
last spot until it expires. The iOS app's background location
(`backgroundLocation.js`) could keep timed shares moving; not wired yet.
Expired docs are hidden, not deleted, if the sharer never reopens the app.

## Save for later is device-only (2026-10-13)

The bookmark's Save for later list lives in the trip state
(`trip.savedForLater` in `lib/TripContext.jsx`), like solo itineraries: on
this device's storage, not synced to the account. Signing in on another
phone shows an empty list. Syncing it (and solo itineraries) through
Firestore is open.

## Founder and family accounts in the owner stats (needs the UIDs)

`src/lib/familyAccounts.js` holds `FAMILY_UIDS`, the founder and family
accounts the admin dashboard leaves out of retention (Academy tab, Retention
page) and the Mapr match rate (Academy, Overview, Mapr Phase 1 page, Slack
alert). Active users and ratings per active user show the total plus an
"outside family" line. The list shipped empty: the owner needs to send the
Firebase Auth UIDs (theirs, their dad's, other family) and a PR adds them.
Until then every number still includes those accounts.

The Retention page cohorts now use the Academy rule (adminStats.js
`retentionUsers`): accounts created since open tracking began (2026-10-01),
opened ON day N. Accounts older than tracking stay out, never back-dated.
The Accuracy page's per-category match rate, the Mapr skip/CTR/A/B numbers
and the long study still include family accounts.

## Categories: Art & Culture and Nightlife merges, four switched off (2026-10-12)

2026-10-13: Nightlife held zoos, aquariums (the Miami Seaquarium) and
theaters after the Entertainment merge. `data/nightlifeSort.js` now sorts
local-life places at load: Attractions (new category, 🎢) for aquariums,
zoos, theme parks, bowling, arcades, boat tours; Art & Culture for
theaters, opera, concert halls, cinemas; bars, clubs, live music, comedy,
cabaret and flamenco stay. Same for user-added places. Pack files are
unchanged; the import scripts still emit local-life/entertainment.

Entertainment folded into Nightlife (id `local-life`) the same way: alias
`entertainment` in `CATEGORY_ALIASES`. The Landmarks tab's Category
dropdown became a row of category emoji buttons (multi-select).
Shops that sat under Local Life (bookstores, record stores, malls,
department stores, antique and art shops, `mall: true`) now load as a new
Shopping category, and farmers markets (topic `market`) as Food
(`normalizeLandmark` in `data/regions.js`, by topic). Pack files still say
local-life; the import scripts weren't changed.

Owner asked to merge Art & Museums into History & Culture as "Art &
Culture" and to switch off 10/10 Benches, Stadiums, Campus Life and
Airports (Formula 1 was already off). The merged category kept the id
`history-culture`; `art-museums` is an alias (`CATEGORY_ALIASES` in
`data/regions.js`) mapped on load for landmark files, place packs,
custom landmarks, saved interests, old reviews and taste scores
(`tagScores.js decayedRegion`). Left as is: the import scripts
(`scripts/osm-import/`) still emit `art-museums` and pack files still carry
it, so a rebuild doesn't move other regions' packs. Switched-off categories
are only out of pickers and filters (`HIDDEN_INTEREST_IDS`); their places
still show and Mapr moods (Sports, Fresh air) still use them. To bring one
back, remove its id from that set.

## Malls (places with stores inside), Test tab only

The Test tab's "Malls" bubble (`screens/MallLab.jsx`, the bubble the tab
opens on) shows a map with only the app's malls, clustered and opening on
the area with the most malls (South Florida): every place with topic `mall`
(imports) or `mall: true` (hand-picked: Dolphin Mall, Brickell City Centre,
Bayside Marketplace, King of Prussia, Santana Row, V&A Waterfront, Galleria
Vittorio Emanuele II), 18 in all. Tap one, Check In (no location needed in
the lab), and the real check-in sheet opens ("Check in to <mall>?", the same
RatingFlow, Post) with a "Which stores did you go to?" dropdown: search,
multi-select up to 4, each picked store rated with its own RatingFlow (loved
it = thumbs up, didn't like = thumbs down, ok = no taste change). Every
check-in is its own visit; checking in again later rates other stores, and
stores rated before are marked. Palm Grove Plaza (`data/testMalls.js`) is
the made-up example the six owner checks run on (`lib/mallChecks.js`).

Store lists are app data (`data/mallStores.js`, built by
`scripts/build-mall-stores.mjs` from `scripts/osm-import/research/malls/`):
store names a result places at the mall, its directory as source, 1-2 tags.
`data/mallStores.test.js` fails when a mall has no stores (standing rule in
CLAUDE.md). Left open: Two malls found no current tenants and need an owner call:
Lincoln Center (690 Lincoln Road, likely a building on the Lincoln Road
pedestrian mall, not a mall: drop its mall topic?) and Ultramont Mall (only
a 2015 source, saying a tower would replace it: still open?). Both sit in
that test's RESEARCH_PENDING list; checking in there skips the store
question. Thin lists to recheck: The Shops at Sunset Place has only AMC (the
mall is mostly empty and slated for demolition), Sunset Harbour Shops 4
stores.

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
