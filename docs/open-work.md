# Open work

Unfinished work and the decisions behind it, newest first. Remove an item in
the PR that finishes it.

## Test tab: Tutorial = sign-up + onboarding combined (2026-10-21)

The owner merged onboarding and the tutorial into one Mapr-led flow, the
Test tab's "Tutorial" bubble (screens/OnboardingLab.jsx): hello, sign up,
verify email, swipe practice (swipe right, swipe left, tap the card, tap a
button; Mapr says what each means), the 39 cards ("a minute max"), anything
else, your places, first check-in, Always location, your tabs, done. All of
Mapr's words and the step order are in screens/signupTutorialSteps.js.
Admin-only sandbox; the real flow (screens/Onboarding.jsx) is unchanged.
Next: the owner edits the text, then the combined flow replaces the real
new-account onboarding (APP_HELP's Onboarding entry changes with it).

Tutorial 2 (2026-10-21): the owner's "First-Run Tutorial Build Guide"
(PDF), built as a Test tab sandbox in screens/FirstRunLab.jsx. State is one
pure reducer in src/lib/firstRun.js (unit tested), the words are in
screens/firstRunCopy.js. Built: welcome sheet over the live Map, taste chips,
3 swipe cards (Interested / Not for me, hint on card one), one rating on the
first Interested, check-in with a distance pill (30 m, feet), progress ring
toward PROGRESS_GOAL (10; the guide says test 10 vs 15), sign-up prompt from
its three triggers, Skip and Skip all on every step, progress kept per
account on the device, analytics events shown on screen. Tests: T2-T8,
T9/T10 (storage), T15, T16.
Not built, since they change the live app or need a decision:
- The guide assumes guests can check in and rate before signing up. The app
  needs an account for both (CheckInButton, LandmarkDetail). Needs the
  owner's call: add a guest mode, or ask for sign-up before check-in.
- No analytics pipeline exists; events only show in the sandbox. Needs a
  choice of where they go (e.g. a Firestore collection, Firebase Analytics).
- "Continue with Apple" is in the guide; the app has no Apple sign-in.
- Rating labels: the guide says "It was okay" / "Not for me"; the app says
  "Ok" / "I didn't like it". Tutorial 2 uses the guide's words.
- Empty states on the five tabs, pull hints (once per account, max 3 per
  session), Profile "Show me around" checklist and "Tips", Firestore sync of
  first-run state, T1/T11/T12-T14 (device, offline, contrast checks).

Agreed with the owner for when the Tutorial goes live (not built yet):
- "View Tutorial" button in Settings, in the bottom card, right under
  "Report a Bug". Tapping it asks which kind of run:
  1. "Update my preferences": the swipe cards, notes and places save for
     real and replace the earlier card answers (check-in ratings stay).
  2. "Just review the app": nothing is saved; a refresher on swiping and
     the tabs.
  Both skip sign-up and verify email (already signed in).
- Demo account (the owner made it; email to come): it shows the Tutorial
  at sign-in for testers, and its sign-in run saves for real. Waiting on
  the email and whether testers share one phone (then it shows on each
  app open, since the app keeps people signed in).
- Update APP_HELP in the same PR so Mapr knows where "View Tutorial" is.

## Mapr chat fact guard, live hours, best order (2026-10-13)

Shipped: Mapr chat can't show a distance, travel time, hours, price or
rating that no lookup backed in that reply (`api/_lib/factGuard.js`). New
tools: `place_hours` (Google Places live hours) and `best_order` (Route
Matrix, fastest order for 2-7 stops). Proof: the chat simulation in
`mapr-synthetic-trainer/chat-facts/` (results in
`mapr-synthetic-trainer/CHAT-FACTS-RESULTS.md`; 300 travelers run in every
test run). Still open:
- The simulation's AI is a stand-in. A live run against the real model
  needs the owner to set a dollar budget (each chat call costs money).
- `place_hours` reads `currentOpeningHours`, a Places API (New) field
  billed at a higher tier than name and location. Watch the Places bill;
  the kill switch is removing the field (Mapr then falls back to web
  search for hours).
- Hours found through web search are trusted, not checked number by number.
- The guard can't tell which place a vague closeness phrase ("a short
  walk") refers to; it keeps one only when a checked route is under 15
  minutes or a mile.

## App simulation: suggestions not built (2026-10-14)

`scripts/app-sim/` runs thousands of simulated users against the
emulators; `docs/app-sim-results.md` has how to run it, the 12 bugs it
found (all fixed) and 14 suggested features and UI changes, not built, in
priority order. Next: the owner picks which suggestions to build. Rerun
the sim (`--emulator-batch 250`) after any big UI change; the Firestore
emulator needs a restart about every 400 sessions or it slows to a crawl.

## Solo streak daily cards: city, variety, warnings (2026-10-13)

Fixed: the 3 daily cards follow the city you are in (the streak's city
moves before the first card is rated that day), skip places you answered on
earlier days (sharedDeck.js avoidIds, from src/lib/soloDeckHistory.js), and
always deal 3. Red streak warnings (header flame, Profile line) show only in
the last 5 hours, like the banner and notification already did. Still open:
the owner said the Streaks page "shuts down the app" and signs them out. No
repro yet (the page renders fine in tests with Miami's places loaded); the
carousel under the cards now has its own error boundary. The app
simulation (2026-10-14) opened Streaks in 415 sessions and never hit an
error screen there while online, so it likely needs the iOS app or real
data. Next step: a screenshot of the "Something went wrong" details, or
the device console.

## Google map online, Esri offline (2026-10-13, needs the owner's key)

The Map tab shows Google's satellite map with labels (Map Tiles API) while
online and keeps the Esri/Carto map and offline download when offline, with
no key set, or when Google tiles fail. Map popups show the Google rating
only on Google's map (Places terms). Nothing changes until the owner
enables the Map Tiles API, makes a browser key restricted to it and the
site's referrers, sets a daily tile quota, and adds
`VITE_GOOGLE_MAP_TILES_KEY` in Vercel. Details: `docs/google-map.md`.

## Google and Tripadvisor ratings on landmarks (2026-10-13, needs owner steps)

Update 2026-10-14: user-added landmarks get Google ratings too, matched
the first time anyone views them (docs/ratings.md, "User-added landmarks").

Update 2026-10-13 (evening): the 735 close calls were checked by hand: 631
accepted, 104 left in review.json (a different place, a chain branch too far
away, or a part of a bigger site). The 436 no-matches were searched again by
"name, city": 164 matched, 235 still have nothing (left in no-match.json),
and 37 were not searched because the daily SearchText cap (400) ran out
(scripts/rating-sources/not-retried.json; rerun them after the quota resets).
3,122 of 3,498 places now have a Google ID. Places without a Google rating
say "No ratings available" (api/landmark-ratings.js googleNoRating).

Earlier 2026-10-13: Google matching ran for all 3,498 places: 2,327 matched
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
offline retry queue (an offline check-in stays unverified), and proof docs
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

Phase 2 (follows and taste neighbors), part 1 shipped: check-in read
limits. A check-in reads only for its owner, their friends, anyone when
the owner's profile is public, never across a block either way, and the
verified admin; list queries must pin `userId`. Cross-owner reads were moved: the regional leaderboard is
added up by `api/regional-leaderboard.js` (names and points only, and only
people the viewer may see who have points), the "Tag Team" badge queries
each friend's check-ins, and `region_stats` is server-written only: the
nightly job recounts every region from the check-ins (a client bump could
not be tied to a real visit, so one account could inflate a count without
limit). Public leaderboard entries no longer carry `lastCheckinId`: a rise
is proven by the owner-only `checkin_payouts/{uid}` doc made in the same
write. Builds from before still send `lastCheckinId` (allowed, proves
nothing), and the nightly job (`api/_lib/checkinUpkeep.js`) scrubs it. New
check-ins can't carry `distanceMeters` / `gpsAccuracyMeters` any more
(pre-Phase-0 builds fail to check in: install a fresh build), `presence`
no longer holds distance or accuracy (version 2), and the nightly job
scrubs both from old check-ins, 400 a night. "Not verified" never says
how far. `users` profiles can't change server-kept fields
(`followerCount`, `followingCount`, `reputation`, `founding`, `levels`,
`serverBadges`, `tipCount`).

Phase 2, part 2 shipped: follows. `follows/{follower}_{followee}`, one-way,
public profiles only, written only by `api/follow.js` (verified email, 60
new follows an hour in `follow_log/{uid}`), which also keeps
`followerCount` / `followingCount` on `users/`. Reads: the follows you made
or got, never a list of someone else's followers (the plan had any
signed-in reader). A block calls the server to remove follows both ways;
account deletion removes yours (best effort). Nightly (`followUpkeep`):
follows across a block or from a deleted account go, and every count is
reset from the follows (skipped past 20,000 follows; page it then). UI:
Follow / Following with the follower count on a tip author's name, the
leaderboard name card and a friend's stats popup; Profile → Follows. The
dashboard's new Network page (`network_metrics/{date}`) shows follows and
the launch area's share of active people following a discoverer (Phase 2
is done at 60%).

Phase 2, part 3 shipped: taste neighbors. `src/lib/maprRank/neighbors.js`
holds steps 1 to 4 (taste vector, shrunk cosine, rating agreement, 0.6 /
0.4 neighbor score, 0.3 floor, High at 0.6) with unit tests. The nightly
job (`api/_lib/neighborsJob.js`) writes each active user's top 50 among
people with a live tip, overall and per city, to `mapr_neighbors/{uid}`
(owner read and delete, server write), skips blocked pairs, and deletes
docs of people no longer active. Both Mapr loaders (`modelStore.js` on the
phone, `maprServerModels.js` for chat) now load `neighbors`; nothing scores
with it until Phase 3. Profiles show "Taste match: High / Some" next to the
follower count, never a number. The doc holds scores, which its owner
could read with dev tools, so rating agreement (step 3) only uses a
finder's ratings where the reader could already read them (public profile,
or friends); otherwise the score is taste alone (a security review showed
fake accounts could otherwise work out a private person's ratings). The Network dashboard page shows how many active people have a
neighbor. Phase 2 is complete.

Phase 3 shipped: community picks. `src/lib/maprRank/community.js` holds
steps 5 to 7 (finder weight, place weight with +0.1 per extra finder and
the 2.0 cap, freshness, ramp, community weight) and the density gate, with
unit tests. Nightly `api/_lib/communityDensity.js` writes
`community_density/{philly,villanova}` (the launch area counted as one:
active people, live tips, places, recent discoverers, median nearby finds,
ramp, gate streak); server and dashboard only. `api/_lib/communityServer.js`
computes each viewer's per-place lift and finder; the phone gets it from
`api/community.js` through `loadMaprModels`, Mapr chat through
`loadServerModels`, and `scorePicks` multiplies it in (feature
`communityPicks`, at 100%). Surfaces: Map sheet picks and every row (reason
line names the finder), new "Found by people like you" row (3 or more),
Travel Picks, trip planner ("Something new" gets one community find),
Places tab For Me plus a "Found by people" chip, Mapr chat (FOUND BY lines
and quoted tips; the misleading "similar taste" wording fixed), landmark
page tips sorted by finder weight. `api/mapr-picks.js` deleted (no caller).
Deviations: freshness scales the lift only, not the whole score; density
numbers are not readable by app users. The Network dashboard shows the
density numbers and community vs Mapr-only skip and visit rates over 30
days (Phase 3 is done when community picks match at least as well).

Phase 4 shipped (part): influence events and local reputation.
`src/lib/reputation.js` holds steps 8 and 9 (event weights, 15 per person,
180-day half-life, trust 1.0 / 0.5 friends / 0.3, levels with minimum
people and Insider's top 5%) with unit tests. Nightly
`api/_lib/reputationJob.js` builds `influence_events` (server only) from
marks, views, verified check-ins and ratings, writes `reputation_scores`
(server only) and `reputation/{uid}` (levels and badges, signed-in read),
and keeps the first 25 Locals per launch city in `community_founding`.
Reputation feeds finder weight (1 + 0.5 x score / 250), and Trusted or
Insider finders reach everyone ("Trusted in Philadelphia" on their cards).
Profile → Discoverer shows levels, badges and the "Trusted in {city}"
board (`api/reputation-board.js`, names and levels only); profiles show
a person's best level. The Network dashboard shows events, went per week,
levels per city and a friend-ring count. Not done, for the owner to
decide: retiring points (stop payouts, client leaderboard writes off,
replace the points boards and level bar); and the plan's "learning" (a
tip teaching your taste, a Helpful or Save as a half "I'd go"), which needs
the taste rebuild (`rebuildGlobalTaste`) to include tips so it survives a
rebuild.

Phase 5 shipped: discovery alerts (`api/_lib/alerts.js`), all written by
the server into `notifications/` with a push where the plan says:
tip went (nightly, once a day), tip helpful (nightly, in-app), level up
(nightly), new follower (on follow; push for the first 10), follow tip (on
a live tip, followers who have checked in in that region, 2 a day) and
nearby find (nightly check, once a week, a Trusted find within a mile of
`lastKnownLocation` from the last 7 days, of a kind the person likes).
Switches per group in `users/{uid}/private/main.notificationPrefs` (rules
allow known groups as booleans), Settings → Discovery alerts.
`alert_log/{uid}` keeps the limits, server only. The Network dashboard
shows alerts sent and the loop check (repost within 14 days after a "tip
went" against people without one).

Phase 6 shipped: the feed. `api/feed.js` builds 30 items for a launch
city past the density gate (`src/lib/feed.js` `composeFeed`: at most 2 in
a row from one finder, at most 1 in 5 from people you follow, every 6th
item one of Mapr's own picks), ordered by `rankPlaces` with the community
lift; places you rated are left out. `?gate=1` says which launch cities
are open. The Feed tab shows first in the bottom bar, and the app opens on
it once per session, only when the current trip's city is open
(`useFeedCity`); elsewhere the Map stays home. Shown items log to
`recommendation_log` with surface `'feed'`. The Network dashboard shows
feed items shown and day-7 retention of new people in the launch area (the
Phase 6 check: compare before and after the gate opens). All six phases are
built; see Phase 4's note for what's left for the owner.

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
