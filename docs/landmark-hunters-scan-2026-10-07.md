# Landmark Hunters nightly scan: October 7, 2026

Run time: 4:38 AM to about 7:15 AM Eastern.
Branch: `nightly-fixes-2026-10-07` (122 commits on top of `main` at 173174c, #603).

## 1. Summary

**Pull request: not opened.** The run could not push. GitHub refused with "landymontiel25/landmark-hunters is not in this session's authorized repository set." This session had no tool to add the repo with push access. All work is committed on the local branch, and the full change set is attached as a git bundle and a patch file. See "How to get the changes" at the end.

Counts by severity (my rough sort):

| Severity | Fixed | Questions for you | Left as notes |
|---|---|---|---|
| High (crash, freeze, abuse, data shown to the wrong account) | 11 | 4 | 1 |
| Medium (broken flow, wrong data, cost) | 45 | 9 | 6 |
| Low (edge cases, cleanup) | 62 | 8 | 8 |

- Fixes made: 118 fix commits (122 commits in all, counting lint cleanup, a dependency update, one stale comment, and one fix I reverted after review).
- Questions for you: 21.
- Checks on the final branch: 239 test files and 1,865 tests pass (up from 212 files and 1,769 tests). Lint has 0 errors and only the 31 old "fast refresh" warnings. The production build passes. The admin dashboard passes its type check, 46 tests and its build.
- Verdict: the app is in fair shape. Nothing was on fire, but the Map tab froze for up to 40 seconds while place packs loaded, and several account-switch leaks and abuse paths needed work.

How I worked: 18 helper agents scanned the app in 5 rounds, each area by a different agent. Every fix got related tests, and most got a new test that fails without the fix. Three separate review agents then checked every fix for new bugs. They found 11 problems in the fixes, and I fixed or reverted all 11.

## 2. Fixes made

Each line: file and line, what was broken, what changed.

### Map and navigation
- `src/lib/positionCache.js:1`, `src/screens/MapExplore.jsx` markers: the Map froze for about 40 seconds after each load. Every place-pack load rebuilt about 3,500 pins with new position arrays, and each one re-clustered. Pins now keep the same position array while their spot is unchanged. Long tasks went from about 40 s to 1.9 s.
- `src/screens/MapExplore.jsx:655`: the city frame was keyed on the wrong value (`trip.activeRegion` instead of `mapFocus`), so it could frame a stale city. Now keyed on `mapFocus`.
- `src/screens/MapExplore.jsx:913`: built-in pin popups showed stale photos because `myPhotos` was missing from the memo. Added it.
- `src/screens/MapExplore.jsx:350`: asking for directions before the first GPS fix ended on "Turn on location" and never retried. It now retries once a fix arrives.
- `src/lib/navProgress.js:15`: steps with no instruction made live navigation say "In 0.5 mi, Arrive at X" partway along the route. Those steps now fold into the step before.
- `src/lib/offlineMap.js:25`: downloading the Formula 1 itinerary built about 760 million tile objects and froze the tab. It now stops at the 1,500 cap.
- `src/lib/placeLookup.js:31`: places in London snapped into the Formula 1 itinerary (its center is Silverstone). Worldwide regions are now skipped.
- `src/lib/placeLookup.js:46`, `src/lib/routing.js:173`: the places-nearby and OSRM calls had no timeout. Added 15 s and 10 s limits.
- `src/lib/geocode.js:109`: the address search had no timeout, so Trip Setup could sit on "Checking" forever. Added an 8 s limit.
- `src/styles/ux-3.css:74`: on phones under 360 px wide, the nav showed ".andmarks". Tabs there now size to their label.

### Itinerary, trips and group trips
- `src/screens/Itinerary.jsx:420`: with a typed start address, every GPS move re-geocoded it and flashed the full-screen skeleton. The typed address is now geocoded in its own effect.
- `src/screens/Itinerary.jsx:113`: the route map snapped back to the full route on every re-render. It now refits only when the points change.
- `src/screens/Itinerary.jsx:495, 514`: after a re-sort, the list showed the old order (and Start Trip used it) until OSRM answered. Driving times now apply only to the same stop order, and only the refined legs are laid over the current stops.
- `src/lib/routing.js:274`, `Itinerary.jsx`: turning a trip into a group trip used catalog order instead of your saved order. Now uses your order.
- `src/components/TripPlannerCard.jsx:214`: an error left the planner stuck on "Planning…". Now always clears.
- `src/screens/Itinerary.jsx:547`: Undo after Delete Itinerary lost a manual Past/Current setting. Undo now restores it.
- `src/screens/Itinerary.jsx:316`: a slow group-trip load could list the previous account's trips. Old loads are now ignored.
- `src/lib/groupTrips.js:110`, `GroupTrip.jsx`: reordering a group route dropped stops it doesn't show (custom landmarks). It now keeps them.
- `src/lib/groupTrips.js:14, 35`: a member with no name, or a place with an empty field, made group-trip writes fail. Removing a member could also drop someone invited a moment before. Writes now clean empty fields and use `arrayRemove`.
- `src/screens/TripSetup.jsx:184`: a group trip could show the owner's email as their name to every member. It now falls back to "Explorer".
- `src/lib/TripContext.jsx:66`: the old San Francisco id migration could list the same stop twice. Now removes duplicates.
- `src/lib/maprActions.js:443`: a group member with no name reached Mapr as `null`. Now reads "A traveler".

### Mapr chat and recommendations
- `src/screens/Mapr.jsx:385`: a web-found stop that failed to save retried forever (paid Google Places calls plus Firestore writes). It now auto-tries once; tapping still retries.
- `src/lib/maprActions.js:92, 223`: a non-Latin or empty place name matched every stop, so "remove X" could remove a random place. Fixed in both lookups.
- `src/screens/Mapr.jsx:199`: "Create it" and "Try again" on a reopened chat dead-ended. They now use the stops saved in the chat.
- `src/screens/Mapr.jsx:165`: action results could land in a different chat. They now go to the chat they came from.
- `src/screens/Mapr.jsx:285`: a half-done message edit carried over to another chat. Now resets.
- `src/screens/Mapr.jsx:467`: "Ask Mapr about…" was dropped while a reply was in flight. It now waits and sends.
- `api/plan-ai.js:240, 680`: `{{address:N}}` links could point at the wrong place after the server dropped stops. Tokens are now remapped to the kept stops, and the directions card keeps its link.
- `api/plan-ai.js:251, 257`: a broken reply could show the raw JSON, and a plain reply was cut at its first `{`. Both fixed.
- `api/classify-interest.js:7`: the AI call had no timeout (SDK default is 10 minutes with retries). Now 50 s, no retries.
- `api/mapr-picks.js:9`: the only AI endpoint that didn't log its usage. Now logs.
- `src/lib/nearbyPicks.js:172`: hours like "Mon–Thu, Sun 11am–10pm" read as closed Mon–Thu (74 real hours strings). Fixed.
- `api/_lib/maprServerModels.js:16`: one failed read turned off server models for 12 hours. Failures are no longer cached.
- `api/_lib/statsData.js:88`: the dashboard's "v2 model ranked X%" was always 0%. The missing `ncfModel` field is now kept.
- `src/components/nearbyPicks/MapPicksOverlay.jsx:226`: Map sheet rows logged no A/B variants, so they dropped out of experiment reports. They now log them. What the rows show is unchanged.
- `api/_lib/compatibility.js:2`: the streak push could show a different match % than the app (old ids, hidden reviews). Now matches the app.
- `api/_lib/appHelp.js:10, 27, 163, 304`: Mapr's help text was wrong on four points (Landmarks tab city order, push notifications, habit tracking, the AI rate limit). Corrected.

### Accounts, sign-up and friends
- `src/lib/AuthContext.jsx:115`: after tapping the email link, "Verify your email" never cleared. Fixed.
- `src/lib/AuthContext.jsx:68`: if saving the display name failed, sign-up skipped the verification email and the referral. Now continues.
- `src/components/SignInForm.jsx:123`, `AuthContext.jsx`: a name over 200 characters made every check-in fail the rules. Now capped at 200.
- `src/lib/AuthContext.jsx:21`, `accountDeletion.js`: deleting an account left its home address and other data on the device. Now cleared.
- `src/lib/BadgesContext.jsx:112`: a slow badge load for account A could write badges onto account B. Stale loads are dropped.
- `src/lib/RatingsContext.jsx:1`, `src/lib/MyPhotosContext.jsx:1`: after an account switch, the old account's ratings and photos could show. Stale loads are dropped.
- `src/lib/CheckInContext.jsx:58`: the old account's "checked in" marks stayed after a switch, and a new check-in could vanish. Fixed.
- `src/components/Header.jsx:141`, `src/lib/PairStreakContext.jsx:20`: the header showed the previous account's streaks after a switch. Fixed.
- `src/components/OnboardingBanner.jsx:16`: dismissing the banner hid it for the next account too. Now per account.
- `src/lib/friends.js:435`: a friend request could fail on an empty name or expose the sender's email. Now uses safe names.
- `src/components/FriendsPanel.jsx:67`, `FriendsContext.jsx`: a request sent before you blocked someone stayed listed, and accepting it undid the block. Requests from blocked people are now hidden.
- `src/screens/Profile.jsx:95`, `Settings.jsx`: sign-out and refresh failures were unhandled, and sign-out could be double-tapped. Fixed.
- `src/lib/onboardingSave.js:3`: offline, onboarding sat on "Saving…" with both buttons disabled. It now settles like other profile writes.
- `src/components/LocationAlwaysStep.jsx:1`: tapping "Not now" during the location ask advanced twice. Now once.

### Check-ins, ratings and photos
- `src/screens/LandmarkDetail.jsx:2, 591`, `src/data/regions.js:361`: reviews and check-ins saved under the two renamed San Francisco ids were not found, old links showed "couldn't find", and Remove could leave the old rating. The page now finds the old id, redirects old links, and Remove clears both.
- `src/lib/reviews.js:330`, `MyMaprRatings.jsx`: deleting a rating on those two places silently did nothing. Now deletes the stored doc.
- `src/lib/imageUtils.js:36`: each web photo pick leaked the full photo in memory. Now freed.
- `src/screens/AddLandmark.jsx:124`, `LandmarkDetail.jsx`: photo previews were never freed on leaving. Now freed.
- `src/components/LandmarkThumb.jsx:23`: if the first image failed, later images were never tried. Now tried.
- `src/components/CheckInReview.jsx:73`: a late save error from one check-in showed on the next one. Now stays with its own.
- `src/lib/timezones.js:22`: Paris used UTC for admin check-in times. Added Europe/Paris.
- `src/components/MyCommentEditor.jsx:20`: editing a shared comment on one row left the other row showing old text. Fixed.
- `src/components/RateLandmarkSearch.jsx:154`, `LocationAutocomplete.jsx:28`: a slow search or lookup could override a newer one. Fixed.
- `src/components/HabitPlacePrompt.jsx:45, 106`: repeated paid lookups for the same spot, and a nearby-stop answer could show on the wrong place. Fixed.
- `src/lib/search.js:21`: typing "joe’s" (iPhone apostrophe) didn't find "Joe's Pizza". Both apostrophes now match.

### Streaks, points and leaderboards
- `api/_lib/leaderboardPoints.js:37`, `ensure-solo-streak.js`: a crafted name (an object or 1 MB string) could be written to the public leaderboard and crash it for everyone. Names are now cleaned.
- `api/close-streak-day.js:74` and two other endpoints: a solo streak could be passed to pair endpoints for extra freezes and points, and could crash recovery. Solo docs are now refused.
- `api/close-streak-day.js:5`: a recovery mission could open after this month's was used, and could never be finished. Fixed.
- `api/reset-dual-streak.js:55`: Reset to 0 failed on older pair streaks with no `mode` field. Fixed.
- `api/_lib/closeSoloStreakDay.js:7`, `close-streak-day.js`: the server could draw a different deck than the phone for old San Francisco ids, so a pair day couldn't close. Fixed.
- `src/lib/pairStreaks.js:155`, `soloStreaks.js`, `MyStreaks.jsx`: a card rated right after midnight was saved to the wrong day. Now uses the day on screen.
- `src/screens/Notifications.jsx:15`: the streak countdown ignored a freeze that held today. Fixed.
- `src/lib/leaderboard.js:269`: renaming failed for users with over ~500 check-ins (one batch over Firestore's limit). Now batches under 500.
- `src/lib/leaderboard.js:636`: regional board rows had no id, causing duplicate-key warnings. Fixed.
- `src/components/CheckinsGallery.jsx:15`, `MyCheckins.jsx`, `FullStats.jsx`: showed "0 total points" while loading or after a failed read. Now shows a skeleton or "–".
- `src/screens/FullLeaderboard.jsx:16`: stale comment fixed.

### Server jobs, admin dashboard and config
- `api/_lib/place-photo` path (`placeLookup.js`, `place-photo.js`, `photoBackfill.js:97`): one request with a junk name could hide a landmark's photo for 30 days. The cache now ties "no match" to the name searched.
- `api/_lib/verifyAuth.js:18`, `api/_lib/firebaseAdmin.js:46`, `api/_lib/maprNightly.js:254`: sign-in check, Auth lookup and Slack webhook had no timeouts. Added.
- `api/admin-jobs.js:43`: a non-JSON body crashed with a non-JSON 500. Now 400.
- `api/_lib/dashboardDocs.js:45, 78`: the weekly job erased the real "last trained" date, and one id with "/" broke the nightly dashboard write. Both fixed.
- `api/_lib/createdAtBackfill.js:56`: a failed Auth lookup saved a worse sign-up date for good. Those users are now retried.
- `api/mapr-nightly.js:34`: on Mondays, a weekly error skipped the daily report. The daily part now still runs.
- `src/lib/adminStats.js:306`: two "last 7 days" cards counted different windows. Now the same.
- `admin-dashboard/app/api/auth/login/route.ts:2`: a too-short password or JWT secret said "Wrong password" or crashed. Now says what is wrong.
- `admin-dashboard/components/AutoRefresh.tsx:3`, `lib/listeners.ts`, `lib/jobs.ts:17`: an expired session polled "Sign in first." forever. It now goes to /login, and an upstream 401 from the app is reported as 502 so it can't loop.
- `.github/workflows/ci.yml:21`: CI never checked the admin dashboard. Added a job.
- `.env.example:28`: six server variables were missing. Added.
- `.gitignore:16`: added patterns so service-account key files can't be committed again.
- `package-lock.json:36`: `npm audit fix` (non-breaking): brace-expansion DoS fix, source-map-js, Firebase 12.17 to 12.19.

### Performance
- `src/lib/BadgesContext.jsx:77`: every trip edit re-ran the full badge reload (7+ reads). The trip count is now computed locally.
- `src/lib/UnitsContext.jsx:1`, `ToastContext.jsx:1`, `RatingsContext.jsx:97`, `PairStreakContext.jsx:1`: provider values were new on every render, re-rendering 16 to 19 files on each GPS fix or toast. Now memoized.
- `src/lib/nearbyPicks.js:825`, `src/lib/geocode.js:64`: two device caches grew without limit. Now capped at 12 sets and 500 addresses.
- `src/screens/FriendCheckins.jsx:1`: re-read all of a friend's check-ins on any re-render. Props are now stable.

### Lint and code cleanup
- `api/_lib/appHelp.js:91` and 11 other spots: removed unused imports and variables, useless escapes (strings stay byte-identical), and noted intentional hook dependencies. Lint warnings went from 30 to 0, not counting the old fast-refresh ones.

### Reverted on purpose
- `src/components/CheckInReview.jsx:128`: a fix that refused "Rate a Landmark" on unrateable places changed a working flow. I reverted it and made it question 12.

## 3. Found but not fixed

These are low risk, or need a bigger change than a nightly fix.
- 31 "fast refresh" lint warnings: context files export hooks next to components. Dev-only. Fixing means splitting files.
- The `geo` chunk is 2.2 MB. Loading region data on demand would speed first load.
- Every rating save re-reads the whole `landmark_ratings` collection. `custom_landmarks` is fetched by 9 places separately. TripContext and CheckInContext re-render every consumer. All are bigger refactors.
- Firestore free-point paths (fake check-ins, leaderboard +100 writes) need a server endpoint. See question 14.
- Saving over an old-id San Francisco review still makes a second review doc. Other people's old-id comments don't show on the new page. See question 15.
- Two first-ever check-ins at once can both pay 100 points (needs a rules change).
- Small races: header points for users outside the top 50, love-reason prompt, Trip Setup address edit while "Checking…", GroupTrip state when jumping between two group pages, nav overlay when two stops share exact coordinates.
- Saved Mapr chats are capped by characters, not bytes, so a chat heavy in emoji could pass Firestore's 1 MB limit.
- Settings can show an old toggle value if the profile re-read fails after a good save. Home address can stay on "Saved" offline.
- A 61st group-trip place gives a generic error. Sending a request to someone you blocked gives a generic error.
- Nightly jobs read whole collections. Fine now; they will need paging as users grow.
- Remaining npm advisories (grpc through Firebase, uuid through Capacitor CLI) need breaking downgrades.
- iOS: `GoogleService-Info.plist` is not in git. Confirm it is on the build machine or push won't work.
- A streak freeze can race with a second tap (the fix depended on a streak-rule change I held back, question 13).

## 4. Top 3 things to review first

1. **Give the routine push access, then open the PR.** The fixes are only on the local branch. Use the bundle below, or add the repo to the session's sources so the next run can push.
2. **The Map freeze fix** (`positionCache.js`, `MapExplore.jsx`). It is the biggest user-facing change. Open the Map on a phone and check pins, clusters and admin pin dragging.
3. **Security items:** confirm the old service-account key (id `8bc84a2c…`, removed in c43b0cd but still in git history) is deleted in Google Cloud, then read questions 7 and 14.

## 5. Questions for you

Each one would change a feature, so I did not make the change.

**1. Mapr chat explores at 50% for everyone.**
Found: chat never gets rating dates and logs every seen place as skipped. So every user counts as "stagnating" and gets the top exploration rate (0.5). The phone uses about 0.15 for the same user. Two related wiring gaps: chat ignores per-city taste for exploration, and Travel Picks, the trip planner and chat don't pass public ratings, so they can "explore" places rated badly.
Why a feature change: chat results would change.
Options: (a) send rating dates and fix the skip log, the per-city taste, and pass ratings on all surfaces; (b) leave as is.
Recommend: (a), on every Mapr surface in one PR.

**2. Mapr Score and hidden predictions count each rating twice.**
Found: `sitewideTagCounts` adds the "all" bucket on top of each city, so the 5-rating and 2-per-tag minimums pass at about half.
Options: (a) skip the "all" bucket when city buckets exist; (b) leave.
Recommend: (a). Mapr Score will read "still learning" a bit longer for new users.

**3. Travel Picks server keeps only 40 check-in counts.**
Found: `api/mapr-picks.js` cuts the list to 40 after asking for 2,000, so the popularity tie-break is wrong. Also, no app screen calls this endpoint anymore.
Options: (a) raise the limit; (b) remove the endpoint and update CLAUDE.md; (c) leave.
Recommend: (b) if it is truly unused, else (a).

**4. "Download for offline" doesn't work.**
Found: the service worker matches `basemaps.cartocdn.com` but tiles come from `a/b/c.` subdomains, and the download saves CARTO dark tiles while both maps show Esri satellite tiles. Big cities keep only low zoom levels yet say "Downloaded".
Options: (a) download Esri tiles and fix the host match with a cache limit (check Esri's terms on bulk caching first); (b) hide the button until this is done.
Recommend: (b) now, (a) later.

**5. "Book Now" opens a second copy of the app on 626 paid places.**
Found: the link is `#` when a paid place has no booking URL.
Options: (a) hide the button when there is no URL; (b) link to a web search for tickets.
Recommend: (a).

**6. "Finish Onboarding" can loop back to Profile.**
Found: if saving the +10 bonus fails after the cards, the card shows forever and its button bounces back.
Options: (a) show the done screen and retry the bonus; (b) have the card retry the bonus itself.
Recommend: (b).

**7. Admin check doesn't require a verified email.**
Found: `isAdmin()` in both rules files checks only the email claim.
Options: add `email_verified == true` to both.
Recommend: yes, after confirming your admin account is verified (Google sign-in always is).

**8. Leaderboard weeks use each phone's own time zone.**
Found: a 9 PM Sunday check-in in New York lands in a different week than a viewer in Europe sees.
Options: (a) use UTC weeks; (b) use one fixed zone (Eastern); (c) leave.
Recommend: (b). The current week splits once at deploy.

**9. Points are almost always 0, so levels and regional boards look stuck.**
Found: only the first check-in ever pays points, so everyone stops at Level 2, and regional boards are mostly "0 pts" rows.
Options: (a) base levels and regional boards on real visits; (b) restore check-in points; (c) leave.
Recommend: (a).

**10. Dashboard refresh cost and "Reported" dates.**
Found: each open dashboard tab runs a full refresh job on load and every 5 minutes. The Taste page's "Reported" date is overwritten on every run.
Options: skip the refresh when data is under 5 minutes old; show "last shown" instead of "reported".
Recommend: both.

**11. Google Places and directions endpoints need no sign-in.**
Found: anyone can call them on your Google key. Only a per-instance IP limit applies.
Options: (a) require sign-in (signed-out address search and directions would stop); (b) leave.
Recommend: (a).

**12. Rating a Google place that has no rateable category.**
Found: "Rate a Landmark" saves a 0-point check-in, skips the rating, and says "Rated!".
Options: (a) filter those places out of Rate a Landmark; (b) let them be rated.
Recommend: (a).

**13. Streak rules.**
Found: (1) a freeze spent yesterday revives a streak that lapsed days ago; (2) recovery missions open on long-abandoned pairs; (3) the solo repair and the day-close count different things; (4) the pair deck can change mid-day after a real check-in; (5) users can close yesterday's day this morning; (6) the freeze month can flip near midnight on the 1st; (7) milestone bonuses repay after a reset. A ready fix for (1), with a freeze transaction, was written and tested but held back.
Recommend: approve (1) and (2) first; decide the others as product rules.

**14. Firestore rules hardening** (rules auto-deploy, so test in the emulator first).
Found: anyone can set any landmark's displayed average; a fake pair-streak create can set any recovery count; backdated `pick_feedback` can inflate the solo streak; fake check-ins and leaderboard writes pay points; `region_stats` can be poisoned; invite notifications can carry any text; blocks aren't enforced on friend review lists or replies; `users` can be listed by any signed-in user; authors can clear reports by re-posting; one account can hold many usernames; `bug_reports` and `feature_requests` have no size limits.
Recommend: fix the average, streak create and pick_feedback rules first; exact diffs are ready on request.

**15. Old San Francisco review ids.**
Found: reviews under `washington-square-park` and `the-battery` (now `-sf`) make duplicates when edited.
Options: a one-time admin job that moves them to the new ids.
Recommend: the admin job.

**16. Group trip members can't leave.**
Options: add "Leave this trip" for non-owners (the rules already allow it).
Recommend: yes. Needs an APP_HELP line.

**17. Blocking a friend doesn't unfriend them.**
Options: (a) blocking also removes your side of the friendship and hides them from lists; (b) show a note.
Recommend: (a).

**18. Small travel and trip rules.**
Found: travel time drops from 15 min at 1,200 m to 2 min at 1,201 m; a habit place over 120 km from any city is marked "added" but added nowhere; group trips with stale ids never move to Past.
Recommend: fix all three.

**19. Small UI items.**
Found: the "Within X mi" pill on the Map's picks sheet does nothing; admins' 6-tab nav may still clip "Landmarks" at 390 px.
Recommend: make the pill plain text; apply the narrow-phone tab sizing at all widths.

**20. Dependency advisories that need breaking changes.**
Found: grpc (through Firebase) and uuid (through Capacitor CLI).
Recommend: wait for upstream patches; don't downgrade.

**21. Old service-account key in git history.**
Found: commit 35bac0d added a full private key. It was removed later but is still in history.
Recommend: confirm it is deleted in Google Cloud. If the repo is public, consider purging history.

## How to get the changes

The branch could not be pushed. Two files come with this report:
- `nightly-fixes-2026-10-07.bundle`: from your repo, run `git fetch <path>/nightly-fixes-2026-10-07.bundle nightly-fixes-2026-10-07:nightly-fixes-2026-10-07`, then push it and open the PR.
- `nightly-fixes-2026-10-07.patch`: the same changes as one patch (`git am` it on top of 173174c).
