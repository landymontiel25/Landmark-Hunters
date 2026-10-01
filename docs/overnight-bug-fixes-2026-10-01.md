# Overnight bug hunt: everything fixed

Branch: `claude/peaceful-knuth-q829yv` (pushed, 120 commits ahead of `main`, 253 files).
Run: 3:53 AM to about 8:25 AM Eastern. About 45 agents in 9 waves tested the app, fixed bugs, and reviewed each other's fixes.
Checks on the final state: 135 test files and 839 tests pass, production build succeeds, lint shows warnings only, and a production-build smoke test of 15 routes at 390 px and 320 px found no errors.

Each line: what a user saw, then what changed.

## Decisions for you (read these first)

1. **Catalog has no places near Doral.** Zero landmarks within 5 miles of Doral, nearest is 5.7 miles (El Palacio de los Jugos), 28 within 10 miles. Your dad's 7 to 9 mile picks were the nearest places the catalog has. Fixing it for real means adding Doral and west Miami landmarks. The picks changes below make the experience much better until then.
2. **No Delete Account button.** The Legal page mentions one, Profile has none. Apple requires in-app account deletion for apps with sign-up.
3. **Rules change I did not apply (`firestore.rules`).** Saving a star rating after a comment-only review was always denied. The app now works around it. A cleaner fix is to let `landmark_ratings` count +1 when the review exists but had no stars. The proposed diff is below.
4. **Rules that are too open (not changed).** `users` is readable by any signed-in user, including email, home address, last location, and push tokens. Any user can raise `bonusPoints`, `leaderboard_entries`, and fake check-ins by 100 per write with no limit. `landmark_ratings` can drift by 5 per write. `region_stats` is writable by anyone. A review's author can delete and recreate a reported review. Storage lists are readable by any signed-in user. Check-ins are readable signed out. Streaks can be created with a stranger. Referral bonuses can be farmed. Notifications to the admin can be forged. Reply reads ignore hidden and blocked.
5. **Things I reverted on purpose.** One agent changed the Mapr Picks model from `claude-opus-5` to Haiku, so I kept your Opus setting. One added `maxDuration: 60` to `vercel.json`, which can fail a deploy on some plans, so I removed it. One loosened the `custom_landmarks` list rule to `if true`, so I reverted it (a real emulator run showed normal users can already list). One switched Firestore to a persistent on-device cache. It keeps queued writes across restarts but retains the previous account's cached data on shared phones and was untested on iOS, so I reverted it.
6. **AI timeouts only help if your host allows them.** The handlers now time out at 25 to 50 seconds. If your Vercel plan stops functions earlier, the platform limit wins.
7. **Data to check by hand.** Two Aranjuez restaurants (`aguatinta-restaurant`, `almibar-restaurant`) share identical coordinates. `merion-cricket-club` has only a photo that looks like a portrait of the architect. 12 places are marked free but list a dollar cost. Six landmarks now show the placeholder tile because their only photos were of the wrong place. 147 more already had no photo.
8. **Old San Francisco check-ins.** Two SF landmarks shared ids with New York (`washington-square-park`, `the-battery`) and were renamed with an `-sf` suffix. Reads translate old ids. Old check-in documents keyed by the old id are not migrated, so someone who visited those two places before could check in again.

Proposed rules diff (also saved on local branch commit 7c678c0, not applied):

```
(countDelta == 1
  && existsAfter(review) && getAfter(review).data.get('stars', 0) > 0
  && (!exists(review) || get(review).data.get('stars', 0) == 0))
```

## Your dad's complaint (picks far away)

- Hand-added places (like Tapia) were never recommended. They now appear and rank.
- Distance now counts in the ranking: a 0.3 mile pick beats an equal pick 8 miles away.
- When nothing is inside the chosen radius, the sheet shows "Nothing within 1 mi. Nearest: X (5.7 mi)" with a one-tap "Widen to N" button. At the 100 mi chip it no longer says "try a wider one".
- Smart default distance: the smallest option that has at least 3 places, remembered per person (Doral 10 mi, Midtown Manhattan 1 mi).
- Picks cached from earlier now recompute their distances from your live position. They were up to 4 hours stale.
- Picks used a 10 km location grid, so travelling a few miles reused an old set. The grid is now about 1 km. Sets rebuild after 30 minutes and when you return to the tab.
- Already-rated places were suggested again as picks, "Because you liked", and "Time to eat?". They are now skipped.
- The picks clock froze at app launch, so the lunch card never appeared after a morning start.
- Distance chips and the zoom control were hard-coded "mi". They follow the Units setting.
- Moved pins applied only on the map. Distances and check-ins on other screens used the old position. Now consistent.

- Follow-up request: places you rated 4+ stars ("I loved it") within a mile now go first in "Picked for you right now" (up to two, tagged "You loved this", skipped when closed or when you are standing at them), with one "Something new" kept in the third spot. They use your live location and current ratings, so a new rating or a short walk shows up right away.

- Test tab only (admin): `/test` is now a copy of the Map with a refresh button right after "Picked for you right now". Each tap builds a new set that puts places not shown yet ahead of the ones that were, so the same places don't come back. The real Map has no button. The old onboarding sandbox moved to `/test/onboarding`.

## Add landmark and check-in (what you asked for at the start)

- Auto check-in near a new landmark opened without the rating questions. It now asks "Do you like Peruvian food?" style questions. Landmarks created from a Google place also keep their topic.
- Short typed names are only replaced by the resolved name when it extends them as whole words ("Tapia" becomes "Tapia Peruvian Restaurant", "Bar" no longer becomes "Barnes & Noble").
- A pin added more than 100 km from any city opened "We couldn't find that landmark". It now has a stable `custom` region and shows in itineraries, galleries, and duplicate checks.
- Double tapping Add created duplicates. A long address used as the name exceeded the 120-character rule and failed. A missing visit time became 5 minutes. A stuck "Verifying..." spinner now times out at 40 seconds. Latitude and longitude are range checked.
- Tapping a suggestion also resolved the top suggestion on blur and could pick the wrong place.
- Owners can delete a custom landmark from its page (with confirm), and it leaves their itinerary.

## Ratings, comments, photos

- Post stayed greyed after "How was it?" on a Mapr reply or a restored draft.
- Star averages could exceed 5 and counts were wrong when comment-only reviews existed. "Already rated" showed on unrated places.
- Re-checking in at a rated place opened a blank form and Post wiped the saved comment. Re-checking at a different tier carried over the old tier's chips.
- Rating after a comment-only review always failed with permission-denied.
- Only the first picked photo uploaded. Later photos overwrote earlier ones. Large phone photos failed at 8 MB. Photos are now downscaled, capped at 3 per review, and failures say why. Photo preview memory is released.
- Editing or deleting a rating skewed the Mapr taste scores. Edits now apply only the difference and deletes roll back.
- A place rated through search said "Check in here first to rate it" with no way to edit. "Remove my rating" was unreachable and is now a confirmed button. A failed photo upload could not be retried.
- "Checked in:" showed the rating date when you rated first.
- A double tapped save could erase the first rating and count twice. An offline save hung with no message.

## Check-ins, points, streaks, leaderboards

- Rating-only claims counted as visits, so your first real check-in paid 20 points and the "why do you love it" prompt fired a visit early.
- "+100 pts" showed on repeat visits that paid 0. "Check In Again (+100)" promised points it did not pay.
- After deleting a check-in, the next check-in failed with "already claimed".
- Streak numbers were stale after a missed day. A freeze spent in a US evening covered "tomorrow" and the streak still broke.
- Two partners finishing together both advanced the streak and both got points. Closing a day is now a transaction.
- A failed "day complete" call never counted the day. It retries.
- Streak points could land in the wrong week or month near boundaries.
- Recovery missions restored the old count without the days since the break. Month rollover was mishandled. Reset to 0 is now typed "RESET" and keeps your best streak.
- Header, banner, and Profile disagreed about streaks. A freeze today still showed a red warning. Badges stayed "secured" past midnight or after the phone slept.
- Tied scores got different ranks. Users below the top 50 saw "0 pts". Renamed friends showed old handles.
- Forged day ids could farm points. Referral bonuses could be paid twice.

## Accounts and friends

- After switching accounts, the previous account's username, friends, onboarding state, itineraries, and queued badge popups could show. Itineraries now reset only when a different account signs in.
- On a cold open, signed-in users saw the Sign In form, "All caught up", or were bounced out of onboarding.
- A fresh session read a half-written profile, so onboarding looked unfinished and a denied notification write fired on every sign-in. Finishing onboarding wrote to a notification that did not exist. Only the first account ever got the onboarding notice.
- Crossing friend requests stayed pending forever. A re-sent request stayed hidden and gave a generic error. A deleted account left a ghost friend. A cache-only miss could delete a live friend.
- Friend compatibility scores were silently blank. Account deletion left photos behind.
- Push token refresh died after email verification. Push notifications kept arriving for the old account after sign out. Change Password showed for Google and Apple accounts and failed confusingly.
- Create Account said "Sign In". A whitespace-only name was accepted. A failed welcome bonus was silent.
- Admin Mode switched itself off on every reload. Admin edit panels wiped extra categories and photos.

## Map

- Mouse swipe on the picks sheet did nothing. Directions left an action sheet over the map. Tall popups hid their photo and close button. A "Timeout expired" banner showed while your blue dot was on screen. In landscape the sheet filled the screen.
- Raw geolocation errors ("User denied Geolocation") are now plain sentences.
- GPS jitter at the destination could flip arrival back to turns or trigger a reroute. Small GPS jitter no longer re-renders the whole app.
- Map attribution wrapped to 3 lines behind the nav.
- Hours parsing: past-midnight ranges, hours listing only other days, "Sun closed" ordering, and a bare "9-5" read as 9 AM to 5 AM.
- Background location watcher kept running after you turned it off, and a late failure erased the newer watcher (battery drain).

## Trips

- "All stops in Google Maps" silently dropped stops after the 10th. It now splits into "part 1 of 2" links.
- A saved city id missing from the catalog crashed Itinerary. Ghost itineraries and inflated stop counts came from Mapr place ids. The 25-member cap gave a generic error and now explains itself. "X of Y visited" could never complete. A failed drag-reorder was silent.
- Mapr: after about 10 messages every reply failed ("AI request failed"). Truncated replies showed raw JSON. Reply landed in the wrong chat after switching. The newest message hid under the composer. Enter could double send. Errors say what happened (offline, busy, slow) instead of "We couldn't find that".

## Offline and errors

- A region showed "Downloaded for offline" with a green check even when every tile failed. Retina phones never showed the offline map. Distances showed "1000 m". A blocked-storage browser (Safari private mode) crashed at startup in several places.
- One crash in the header, nav, or banners blanked the whole app. Each now has its own boundary and the nav falls back to plain links. A missing screen file reloaded forever when storage was blocked.
- A failed stats read showed "0 check-ins, Level 1". A failed profile read showed a skeleton forever. Both now show a retry.
- Offline: the check-in spinner hung about 25 seconds. Friend requests, settings, custom landmark adds, blocks, and replies now say "Saved on this device" and warn if a queued write is later rejected.
- The theme you picked was ignored until you opened Settings. The app default is now consistently dark.
- Photo permission denied did nothing. It now explains how to turn it on.

## Screens, text, and accessibility

- Light mode: the Mapr screen, modals, popovers, and inputs were dark text on dark. Sideways scrolling at 320 px on Settings, Profile, the header, and landmark cards. Long links in Mapr replies pushed the page sideways. Long friend usernames pushed Accept and Decline off screen.
- Every dialog now has Escape, focus trap, and focus return. Visible keyboard focus ring. Per-page titles. 200% text works. Reduced motion respected. Tap targets enlarged. Arrow-key reorder in itineraries. Light-mode contrast improved.
- Onboarding showed a location step that only works in the iOS app and always errored in a browser. First check-in had no button when location was denied. "Rate 10 places" counted down wrongly. "the 0 you answered". Gibberish search matched everything. "No cities match" now shows.
- Mapr's help text had wrong claims (sign-out clears trips, no check-in detail, incomplete badges and levels). It is corrected and a test ties its numbers to the code.
- Copy: "1 notifications", "1 stops", a missing space ("Ana Friendpicks"), "Miamix27s" in four Miami summaries, "Not Sure" now says "Ask me again in a week", "Ticketed" now says "Needs a ticket", "Taste Profile 34% confident" now reads "Mapr is still learning your taste".
- Landmark photos: 28 wrong-place photo links removed (Treblinka on Cape Town's Holocaust Centre, UK ice cream shops on a Madrid cafe, St Peter's dome on a Milan basilica and a Philadelphia arboretum). Four mis-placed pins fixed (Madrid Botanical Garden was 45 km off, plus two in Milan and one at El Escorial).
- Landmarks list first paint 2.4 s to 1.0 s. Search typing 1.1 s to 0.5 s. Fewer duplicate database reads at launch.

## Test infrastructure

- Vitest now skips `.claude/` worktree copies and allows 20 seconds for heavy screen tests (5 seconds failed under load).
- Tiny `VITE_USE_EMULATOR` hook in `src/lib/firebase.js` lets you run the app against local Firebase emulators.

## Not fixed (minor)

- "zzzz" in the landmarks search still returns some results (sound-based fuzzy match).
- Group trips have no Start Trip button, and the nav label "Landmarks" clips slightly at 320 px.
- Profile's Sign Out button has no busy state. The full leaderboard shows no row of your own beyond the top 200.
