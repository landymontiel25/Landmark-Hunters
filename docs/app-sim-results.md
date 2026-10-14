# App simulation: thousands of simulated users (2026-10-14)

The owner asked for thousands of simulated users on the whole app, every
bug they hit fixed, and a list of features and UI changes (not built).
`scripts/app-sim/` is the simulator. This page says how to run it, what
the runs found, what changed, and what to build next.

## How to run it

Everything runs on the machine: a sim build of the app, the Firebase
emulators (project `demo-lh`, never real Firebase) and canned answers for
every `/api/*` function and outside host (map tiles, photos, Nominatim,
Google). No real key is used, and the sim's Chromium resolves no outside
host, so nothing leaves the machine.

1. `node scripts/app-sim/start-emulators.mjs` (auth, Firestore, Storage
   with the repo's real `firestore.rules` and `storage.rules`; Java needed).
   It writes its own `firebase.json` into `scripts/app-sim/.work/`, since
   the repo's has no emulators section, and gives the Firestore emulator a
   6 GB heap (`SIM_EMULATOR_HEAP` changes it).
2. `node scripts/app-sim/run.mjs --sessions 500 --workers 14 --seed scale --build`
   - `--build` makes the sim bundle in `scripts/app-sim/.dist/`
     (`VITE_USE_EMULATOR=1`, demo Firebase config, not minified so stack
     traces name the app's functions) and serves it with `vite preview`.
   - For long runs, skip step 1 and pass `--emulator-batch 250`: the run
     starts the emulators itself and restarts them, empty, every 250
     sessions. The Firestore emulator's heap fills after about 400
     sessions and it then spends its time in garbage collection.
   - `--seed` and the session number pick the persona, place, starting
     screen and every choice a session makes. To repeat one:
     `--seed scale --only 417` (the report prints this line for every
     problem). What is on screen also depends on the data already in the
     emulator, so a repro can take a different turn; `probe.mjs` holds
     fixed browser checks for most of the bugs below.
   - `--from N` and `--max-minutes M` split a long run into parts;
     `node scripts/app-sim/merge.mjs out/run-a out/run-b --out out/all`
     joins their reports. `--shots` saves one screenshot per kind of
     problem per session.
3. Read `scripts/app-sim/out/run-<seed>/report.md` (problems grouped, with
   counts, screens, stack and the steps that led there). `sessions.json`
   has every session.
4. `node scripts/app-sim/probe.mjs` re-checks the specific bugs below in a
   browser (`SIM_BASE` points it at another build).

Playwright comes from the global install (`npm root -g`), not
package.json. Chromium comes from `PLAYWRIGHT_BROWSERS_PATH`
(`/opt/pw-browsers`); the harness never runs `playwright install`. Output,
the sim build and emulator files stay out of git
(`scripts/app-sim/.gitignore`).

### What a session does

Each session is one person on a 390x844 phone (about 9% on a 1366px
desktop: the desktop planners plus 4% of everyone else),
with location on (70%) or off, somewhere in Miami, Miami Beach,
Philadelphia, Villanova, San Francisco, Palo Alto, New York, Madrid or
Wichita (no city nearby). It takes 20 to 60 actions, most sessions short.

| Persona | Share | What it does first |
| --- | --- | --- |
| New user | 30% | Signs up, taps the verification link (75%), goes through onboarding |
| Returning user | 28% | Signs in with an account an earlier session made (ratings, check-ins, trips, chats) |
| Group trip | 12% | Two earlier accounts made friends, one signs in and works on itineraries |
| Guest | 18% | Never signs in |
| Chaos | 7% | Goes offline and back, reloads, opens links, double taps |
| Desktop planner | 5% | Desktop, heavy on Mapr and itineraries |

Actions, weighted by persona: tap a bottom tab (sometimes twice fast), tap
anything on screen (buttons, links, rows, tiles, map pins; inside a sheet
when one is open), type into any field (search words, emoji, 300 and 1,200
character strings, HTML, blanks), pick from a select, back (in-app and
browser), reload, open a deep link (real and broken places, other
people's pages, missing trips), go offline and back, scroll, Escape, move
to another city. Flows: Mapr chat (prompts, quick replies, stop cards),
Places search with sorts, Near Me and categories, a landmark page (check
in while standing there, rate, save, share, directions, add to
itinerary, tips, photos), the Map (search, Picked for you, Within, pins,
center on me, add), Itinerary (create, Use Mapr, Start Trip, share,
group, live location), Profile, Settings, streaks, stats, notifications,
leaderboard. Phones tap with touch events, desktops click.

After every action it records:

- uncaught page errors and `console.error` lines,
- "Something went wrong" screens (online, and separately offline),
- blank screens (no text, no map, 4 s) and loading states stuck 10 s,
- failed requests, 5xx answers, Firestore and Storage 4xx answers,
- anything wider than the 390px screen (once per screen per session),
- floating controls on top of part of each other (both visible, fixed on
  screen),
- taps that changed nothing at all (no DOM change, no navigation, no
  request, no share, no new tab).

`/api` answers follow the real handlers' shapes. 3% of AI calls answer
503 and 5% take 2.5 s, as the real ones sometimes do. Mapr's stub returns
1 to 4 real catalog stops, now and then a web place, and sometimes an
itinerary action (add a stop, create, rename). `ensure-solo-streak`
writes the streak doc to the emulator the way the server does.

## Runs

| Run | Sessions | Actions | Wall time | Notes |
| --- | --- | --- | --- | --- |
| A `run-scale` | 450 | 13,119 | 47 min | Fixes 1 to 4 in. The emulator's heap filled near the end (requests timed out); stopped there. |
| B `run-scale-from460` | 1,080 | 32,304 | 106 min | Fixes 1 to 5. Emulators restarted every 250 sessions. Its findings led to 10 to 12; 6 to 9 came from its screenshots and the probes run alongside. |
| C `run-scale-from1540` | 100 | 2,877 | 13 min | Stopped early to rebuild with the later fixes. |
| D `run-scale-from1700` | 520 | 15,093 | 53 min | Final build, all 12 fixes: no page errors, no overflow, no overlapping controls. Dead-button hits: Try Again pressed again while offline, Forgot password pressed again, one Back. |
| **Total** | **2,150** | **63,393** | **220 min** | 616 returning, 614 new, 386 guests, 269 group trip, 138 chaos, 127 desktop |

All four parts use seed `scale` (session numbers 0 to 2219, with gaps
where a part stopped); `merge.mjs` joins their reports. The 220 minutes
are past the two hours planned: the machine (4 cores, at times shared
with another session's test runs) managed about 10 sessions a minute with
14 workers, and Chromium's renderers were the limit. Each part used the app as it was then, so later parts confirm
the earlier fixes. Before these, about 1,000 earlier sessions (debug runs
and a first scale attempt) built the harness and found bugs 1 to 3.

## Bugs found and fixed

Each: what a user saw, the repro, why, the fix, the test.

1. **Leaving a map mid-animation threw an error.** Tapping another tab
   while the Map was still zooming (to your location, a search result) or
   still loading its marker clusters threw `Cannot read properties of
   undefined (reading '_leaflet_pos')` or `Cannot read properties of null
   (reading 'getMinZoom')`. 22 times in the first 400 sessions (before
   the fix), none after. Repro:
   open the app on the Map, sign in right away (the Profile tab unmounts
   the map while it zooms). Why: Leaflet ends a zoom animation on a 250 ms
   timer and the cluster group adds markers in timed chunks; neither
   checks that its map still exists. Fix: `src/lib/leafletGuards.js`
   makes both stop once the map is gone; every map screen imports Leaflet
   through it. Test: `src/lib/leafletGuards.test.js` (fails without the
   guard).
2. **A screen flashed "Something went wrong" while the app reloaded
   itself.** When a screen's file failed to load and the app started its
   one automatic reload, the screen showed `Cannot read properties of
   undefined (reading 'default')` until the reload landed, and the reload
   flag was cleared, so a file that was truly missing could reload again on
   the next load. 3 times in 150 sessions. Repro: chaos persona, go offline and back while a screen
   loads. Why: Vite's preload helper resolves the import to `undefined`
   (not an error) once the `vite:preloadError` listener cancels the error;
   `lazyScreen` treated that as a loaded screen. Fix: `settleScreenModule`
   in `src/lib/chunkReload.js` keeps the loading skeleton and the flag.
   Test: `src/lib/chunkReload.test.js`.
3. **Tapping a name on the leaderboard (or a badge tile on Stats) did
   nothing on a phone.** The dead-button check caught it 9 times. Repro: Profile > Compete > full leaderboard, tap a
   name. Why: a tap fires an enter event right before its click; the name
   opened its card on hover and toggled on click, so the tap opened and
   closed it in one go. Fix: hover listens to a real mouse only
   (`src/lib/mouseOnly.js`, used by `FriendPopoverName` and the badge tiles
   in `FullStats`). Test: `src/components/FriendPopoverName.test.jsx`;
   probe `leaderboard-tap`.
4. **A screen opened while offline stayed broken after the connection came
   back.** The offline error card said to reconnect, but after
   reconnecting the screen kept failing until Try Again, and Try Again
   while still offline swapped the app for the browser's own "no internet"
   page. This was the most common error screen in every run. Repro: go
   offline, open a tab not opened yet (Mapr, Itinerary, Streaks), come
   back online. Why: React keeps a failed screen load. Fix: `ErrorBoundary`
   reloads once on the `online` event after a load failure, and Try Again
   offline says "Still offline" instead of reloading. `APP_HELP` says so.
   Test: `src/components/ErrorBoundary.test.jsx`.
5. **A long display name made every screen wider than the phone.** The
   header pill shows the display name until a @username is set, and a name
   can be 200 characters. A 45-character name made all 22 screens 420px
   wide on a 390px phone (sideways scroll, page zoomed out). Fix: the pill
   has a width cap and an ellipsis (`src/styles/theme.css`). Test:
   `src/styles/headerName.test.js`; probe `overflow-sweep` checks 22
   screens in a browser.
6. **The Map's radius menu covered the filter button.** With Picked for you
   open at half the screen, the radius menu rose into the search / + /
   filter column on the left. Covered the filter button at 390x844 with
   the onboarding banner up, and overlapped + and filter at 390x664
   (Safari's visible area with its toolbars). Fix: with the sheet open,
   the menu sits next to the locate button
   (`src/components/nearbyPicks/nearbyPicks.css`). Test:
   `src/components/nearbyPicks/mapControls.test.js`; probe `map-controls`.
7. **The open Picked for you sheet covered the filter button.** Same
   column: at 390x664, and on any phone while the onboarding or offline
   banner was up, the half-screen sheet sat on the filter button and part
   of +. Fix: the open sheet (and the radius menu and locate button above
   it) stops below the left buttons (`--mpp-max`). Test: same file; probe
   `map-controls`.
8. **Offline, the Map never said so, and the header landed on the
   onboarding banner.** The offline banner sat in the page flow under the
   full-screen map (hidden), but still pushed the header down onto the
   map's floating "Finish the swipe cards" banner. Repro: new account, Map,
   go offline. Fix: the banner is sticky above the map and sets
   `--offline-h`; the header and everything placed under it move down by
   it (`src/components/OfflineBanner.jsx`, `src/styles/theme.css`). Test:
   `src/components/OfflineBanner.test.jsx`; probe `offline-map`.
9. **A long word in a review comment made the landmark page 1,819px
   wide.** A pasted link in a check-in comment widened the whole landmark
   page on a 390px phone and stuck out of its card on Check-ins and Stats.
   Fix: `.review-comment` breaks anywhere (`src/styles/theme.css`). Tips
   and Mapr messages already wrapped. Test: `src/styles/longText.test.js`;
   probes `long-text` and `tips-long`.
10. **Back on a page opened from a shared link left the app.** Share sends
    a link to a landmark page. Opened from a text, that page is the first
    one in the app, and its Back button called `navigate(-1)`: on a phone
    it did nothing, in a browser tab with history it left the app (the sim
    landed on a blank page). Same on Add Landmark, a friend's check-ins and
    cities, the full leaderboard, My Mapr ratings and Settings. Fix: they
    all use `goBack` (`src/lib/goBack.js`, now with a fallback), which goes
    to Places, Profile or the Map when there is nothing to go back to.
    `APP_HELP` says so. Test: `src/lib/goBack.test.js` and a Back test in
    `src/screens/LandmarkDetail.placePack.test.jsx`; probe
    `shared-link-back`.
11. **Tapping a check-in's comment on My Check-ins did nothing.** Each row
    opens its place, but the comment block stopped every tap (so its Edit
    button would not also open the place), and the comment text fills the
    middle of the row. Fix: only the Edit button keeps its tap
    (`src/components/MyCommentEditor.jsx`). Test: a new case in
    `src/components/MyCommentEditor.test.jsx`; probe `checkin-photo` taps
    the row.
12. **On a desktop, clicking a leaderboard name or a badge tile closed it.**
    The hover opened the card a moment before the click on the same spot,
    and the click toggled it shut, so a click looked dead. Fix: a click
    within 600 ms of the hover that opened it keeps it open
    (`HOVER_CLICK_GRACE_MS` in `src/lib/mouseOnly.js`). Test:
    `src/components/FriendPopoverName.test.jsx`.

## Checked and fine

Probes for flows a random tapper rarely finishes, all clean:

- `signout-clean`: sign out after opening every screen with live data. No
  listener errors.
- `delete-account`: Settings > Delete Account with the password. The
  account is gone and the app lands on the Map with no errors.
- `group-trip`: a group trip with a friend, share live location for 15
  minutes, Start Trip, then the owner deletes the trip while the friend has
  it open. The page says the trip is no longer available.
- `checkin-photo`: check in standing at South Beach, rate, comment, add a
  photo, Post. The photo lands in Storage.
- `forms`: Request a Feature and Report a Bug send and confirm.
- `tips-long`: a tip with a long pasted link wraps on the landmark page.

The Streaks page (an open item in `docs/open-work.md`) opened in 415
sessions without an error screen while online. Check In, Post, Send in
Mapr and Create Account are disabled or guarded while their first tap
runs (read in the code; chaos sessions double-tap them too). Firestore
transaction conflicts (two sessions rating the same place at once) show
as 409 answers that the SDK retries; nothing is lost.
Every `/api` route the app calls had a stub (none unknown). The app also
calls `router.project-osrm.org` (OSRM routing) directly.

## Not fixed

- **Dead buttons left as they are (by design, listed as suggestions):**
  "0 check-ins" and "0 cities" on Profile do nothing at zero, and "New
  chat" in Mapr does nothing when the open chat is already empty.
- **"[FriendsContext] getUserProfile failed on reload: Profile read timed
  out"** is logged when the profile read takes more than its timeout. It
  showed only while the emulator was overloaded; the app recovers.
- **Firestore emulator memory.** Its heap fills after about 400 sessions
  and it then spends its time in garbage collection: requests time out and sessions
  report "Could not reach Cloud Firestore backend" (kept apart as `infra`
  findings). `--emulator-batch 250` restarts it with empty data between
  batches. This is the emulator, not the app.
- **Nothing in `api/plan-ai.js`, `api/_lib/factGuard.js` or
  `api/_lib/routeLookup.js`.** The sim answers `/api/plan-ai` with canned
  replies, so it tests how the app handles Mapr's answers (stops, web
  places, quick replies, actions, errors, slow replies), not the server.
- **"Blank screen" hits in part D** were the loading skeleton on a first
  load that took over 4 s on the loaded machine, not empty screens.
- **A flaky test, not touched here:** `src/lib/maprRank/pipeline.test.js`
  ("Mapr v2: final = 0.8 * base / max|base| + 0.2 * ncf") failed once in
  a full `vitest run` (`ncfModel` was null) and passed alone and on the
  next full run.
- **Harness caveats in parts A to D.** They shortened CSS animations and
  transitions to 1 ms to save CPU. Transitions then stalled mid-way when
  the onboarding banner moved the map buttons, which the overlap check
  read as overlapping buttons (B and C; not counted above), and a badge
  popup could stall invisible while still catching taps. The harness now
  turns transitions off and leaves animations alone; the probes rechecked
  every fix after that.
- **What the sim cannot see:** native iOS (Capacitor) behavior, push
  notifications, real Google tiles and photos, real AI answers, and
  layout bugs inside cards that clip their own content.

## Suggested features and UI changes (not implemented)

Ordered by how much each would help someone get more out of a day.
Where, what, and why.

1. **"Plan the rest of my day" on the Map.** One button on the Picked for
   you sheet that hands Mapr your location, the time and how many hours
   you have, and gets back a timed route (stop, arrive, leave by, travel
   between). Today that takes a typed chat message plus Itinerary steps,
   and the sheet's picks are a list, not a plan.
2. **Times on Start Trip.** Start Trip shows numbered pins and colored
   legs, but no clock. Add "arrive about 2:15, leave by 3:00" per stop
   from `typicalMinutes` and each leg's travel time, and a "you finish
   around 6:40" line. A trip that runs past the evening shows it before
   you leave.
3. **Hide "Build Itinerary (0)" until something is picked.** On the Places
   tab the floating bar shows with nothing picked and sits over the Info,
   Directions and Check In row of whichever card is under it (in the sim's
   screenshots the first card's row is half hidden on arrival). Show it
   from the first pick, or as a small pill.
4. **Let new users skip email verification for now.** After sign-up the
   Profile tab shows only the "Verify your email" step until the link is
   tapped; someone whose email is slow or in spam cannot see their stats,
   friends or leaderboard there. A "Do this later" that opens Profile with
   a reminder card keeps them going; tips and follows can stay gated.
5. **Keep the onboarding answers above the tab bar.** On "Rate 10 places"
   (390x844) the fourth answer, "Haven't been / not sure", sits under the
   floating tab bar until you scroll. Hide the tab bar during onboarding,
   or add bottom padding, so all four answers are in reach.
6. **One distance control on the Map.** The Map has a zoom radius menu
   ("5 mi") and the sheet has its own "Within" chips, and they mean
   different things (APP_HELP has to explain it). Merge them, or name
   them "Zoom" and "Picks within".
7. **Faster search on Places.** Every keystroke runs a fuzzy match over
   1,000+ places (`editDistance` took about 430 ms of CPU across two
   searches in a profile on a fast machine). Wait about 150 ms after the
   last keystroke, or build the word index once per city. Older phones
   feel this first.
8. **Make zero stats useful.** On Profile, "0 check-ins" and "0 cities" are
   buttons that do nothing at zero. Open the page anyway with "Check in at
   a place near you" and the nearest place, so the first tap teaches the
   main loop.
9. **"New chat" when the chat is already empty.** In Mapr it does nothing,
   which reads as broken. Focus the message box and show the starter
   prompts instead.
10. **Get ready for offline on purpose.** Screens load their files 4
    seconds after launch, one by one; someone who loses signal right away
    (subway, plane) gets the offline card on the next tab. Load Map,
    Places, Itinerary and the landmark page first, and show "Ready for
    offline" in Settings once all are in.
11. **Hide the technical line on the error card.** "Details: Failed to fetch
    dynamically imported module: https://…/assets/Mapr-xSn0KzZ3.js" means
    nothing to a traveler. Put it behind "Show details" (the screenshot
    still has it one tap away).
12. **Mapr tab opens on the chat, not the middle of a form.** With a short
    history, the tab opens scrolled to the bottom and the Taste Profile
    card above the chat shows half a form under the header. Collapse that
    card into a one-line chip on this tab.
13. **ETAs for friends on a group trip.** Live location shows where each
    member is; add how far each one is from the next stop, so the group
    knows who to wait for.
14. **Save for later on every device.** It lives on one phone today
    (`docs/open-work.md`); sign in elsewhere and the list is empty. Sync
    it with the account like Mapr chats.
