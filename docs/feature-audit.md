# Feature audit: everything you add makes everything else less important

Audit only. No code was changed. Every number below was measured from the repo at this commit (line counts exclude tests, data files and CSS unless stated). "Approx LOC" is the sum of the files listed for that feature, and areas overlap a little (shared helpers), so treat them as order-of-magnitude, not accounting.

## 0. The filter

**Core loop:** rate places during onboarding -> get Mapr picks when the app opens -> visit -> check in and rate again.

**One metric:** Mapr match rate = share of Mapr picks the user answers "I'd go" to, or visits and loves.

**Test for every feature:** does it help a new user reach 10 ratings by day 2, or raise match rate? If neither, it is HIDE (behind a flag or out of nav, not deleted), or SIMPLIFY if it is a thin slice of something that does.

Loop steps used in the tables:
- **L1** onboarding ratings (teach Mapr taste, get to 10)
- **L2** picks on open (Map tab sheet)
- **L3** visit (directions, find the place)
- **L4** check in + rate again
- **M** measurement (match rate data)
- **-** none

## 1. The numbers

| Measure | Value |
| --- | --- |
| Non-test, non-data app code (src + api) | ~40,100 lines |
| Tests | ~12,400 lines |
| Landmark catalog data | ~27,100 lines in 18 files |
| CSS | ~7,700 lines (theme.css alone 6,746) |
| Screens (files) | 25, plus 64 shared components and ~170 lib modules |
| Route entries in `src/App.jsx` | 27 (3 are aliases of Profile; 2 are admin-only `/test*`; 1 is the 404) |
| Bottom nav tabs | 5 (Map, Landmarks, Mapr, Itinerary, Profile) plus a 6th "Test" tab for admins |
| Serverless endpoints (`api/`) | 18, of which **7 serve streaks** and **6 call Anthropic** (plan-ai, pick-reasons, smart-search, classify-interest, verify-landmark, mapr-picks) |
| Context providers wrapping the app | 14 (Toast, Auth, AdminMode, LandmarkEdits, Friends, CheckIn, Trip, Badges, PairStreak, Geo, Ratings, MyPhotos, Units, MaprChat) |
| Firestore collections with rules | 25+ (checkins, leaderboard_entries, users, usernames, friend_requests, referrals, blocks, friend_edges, reviews, replies, pick_feedback, streaks, planning_events, recommendation_log, region_stats, landmark_ratings, landmark_overrides, landmark_edits, custom_landmarks, feature_requests, bug_reports, group_trips, mapr_chats, mapr_projects, notifications) |
| Always-mounted overlays | CheckInReview, LoveReasonPrompt, TagCapPrompt, HabitPlacePrompt, CelebrationOverlay, StreakWarningBanner, OfflineBanner, AdminModeBadge |
| Catalog size | **1,244 curated landmarks across 18 regions** (avg 69 per region; median ~62) |
| Catalog per region | Miami 121, NYC 119, Madrid 115, San Francisco 115, Milan 108, Silicon Valley 99, Cape Town 78, Switzerland 65, Philly 63, El Escorial 60, Lake Como 59, Aranjuez 52, Paris 51, Villanova 49, Frankfurt 32, F1 circuits 21, Coral Gables 20, Key Biscayne 17 |
| Regions with 100+ places | 5 of 18 (Miami, NYC, Madrid, SF, Milan); Silicon Valley is next at 99 |
| Onboarding swipe cards | 39 words in 8 groups; **none of them count as ratings** |
| Rating threshold to unlock picks | 10 (`MIN_RATINGS_FOR_PICKS`, `RATING_GOAL`) |

Two things to read off this table before anything else:

1. **Coverage is the biggest risk, not any feature.** A tester outside 5 or 6 cities has a sparse or empty picks sheet no matter how polished the rest is. The default pick radius is 10 miles. Choose tester cities (or tester homes) from the 100+ list (Miami, NYC, Madrid, SF, Milan), or the metric will measure catalog gaps, not Mapr.
2. **Roughly a third of the code (~13,000 lines) is outside the loop** (streaks, leaderboard, friends, group trips, itinerary, in-app navigation, badges, push, background location, offline, Mapr chat management). That is where most of the support and bug surface lives.

## 2. Inventory

Format: Feature | where it lives | approx LOC | loop step | recommendation | why.

### 2.1 KEEP: builds the loop (14)

| # | Feature | Where | LOC | Step | Why |
| --- | --- | --- | --- | --- | --- |
| K1 | Sign in, email verify, password reset | `components/SignInForm.jsx`, `lib/AuthContext.jsx`, `lib/authErrors.js` | ~450 | gate | Picks need an account; cannot test without it. |
| K2 | Map as home screen, with pins and "locate me" | `screens/MapExplore.jsx` (1,457) | 1,547 incl. filter | L2, L3 | It is where the picks sheet lives and where the app opens. Needs trimming (see S3), not removal. |
| K3 | "Picked for you right now" sheet: top 3, expand to list, photo, name, distance, one-line reason | `components/nearbyPicks/{MapPicksOverlay,PicksBottomSheet,PickCard,useNearbyPicks}`, `lib/nearbyPicks.js` (709) | ~1,900 | L2 | This IS the product. Every other feature is judged against it. |
| K4 | Locked state: "Rate N more places", "Rate places" button | `MapPicksOverlay.jsx`, `lib/nearbyPicks.js` (`ratePlacesText`) | small | L1 | The countdown to 10 is the day-2 goal made visible. |
| K5 | Pick reasons (one-line "why") | `api/pick-reasons.js` (118), `lib/pickReasonsApi.js` | ~200 | L2 | Reason text is what makes a pick feel personal; cheap single AI call. |
| K6 | Taste scoring engine (invisible) | `lib/tagScores.js` (660), `lib/tasteProfile.js`, `lib/nearbyPicks.js` ranking | ~1,000 | L2 | Decides which places are picked. No UI. |
| K7 | Quick-rate button on map pins, list rows | `components/QuickRateButton.jsx` (124) | 124 | L1 | One tap to a rating: the fastest route to 10. |
| K8 | Rating flow: 3 tiers (loved / ok / didn't like) + short "why" | `components/RatingFlow.jsx`, `lib/ratingFlow.js` (529), `lib/reviews.js` (530) | ~1,300 core | L1, L4 | Ratings are the input and half of the match-rate outcome. Trim the extras (S2). |
| K9 | "Rate a Landmark" search (rate anything by name) | `components/RateLandmarkSearch.jsx` (302) | 302 | L1 | Lets a new user rate places they already know, which is the cheapest way to 10. |
| K10 | Rating progress bar "N/10 rated" | `screens/Profile.jsx` ~lines 438-458 | tiny | L1 | Direct goal tracker; move it somewhere more visible (S1). |
| K11 | Get Directions (Apple/Google Maps hand-off) | `components/DirectionsButton.jsx` (113) | 113 | L3 | The "visit" step. Keep the hand-off, drop the third in-app option (H4). |
| K12 | Check-in + "rate again" prompt | `components/CheckInButton.jsx`, `CheckInReview.jsx` (332), `lib/CheckInContext.jsx`, `lib/useCheckIn.js` | ~700 | L4 | The "visit and love" half of match rate. See risk R1: check-ins are not location-verified today. |
| K13 | Landmark detail page (core: photo, blurb, rate, check in, directions) | `screens/LandmarkDetail.jsx` (1,327) | core only | L3, L4 | Where a tapped pick lands. Needs trimming (S5). |
| K14 | Account deletion, Legal, Terms | `lib/accountDeletion.js`, `screens/Legal.jsx` | ~310 | gate | App Store requirement, not optional. |

### 2.2 SIMPLIFY: a thin slice serves the loop, the rest does not (13)

| # | Feature | Where | LOC | Step | Recommendation and why |
| --- | --- | --- | --- | --- | --- |
| S1 | Onboarding swipe cards | `screens/Onboarding.jsx`, `lib/onboardingCards.js`, `onboardingSave.js`, `OnboardingSteps.jsx` | ~1,200 (+518 OnboardingLab, admin) | L1 | **Biggest gap in the loop.** 39 swipe cards set tag scores but are not ratings, so a user finishes onboarding at 0 of 10 and sees a locked picks sheet. Make onboarding end with rating real nearby places (reuse QuickRate) until 10, or count confident swipes as ratings. Cut the steps `prompt`, `howto`, `notes`. |
| S2 | Rating extras: ranked aspects (4 loved + 4 disliked lists), visit frequency, review photos, tag-cap prompt | `RatingFlow.jsx`, `ratingFlow.js`, `TagCapPrompt.jsx`, `lib/reviews.js` photo path, `MyPhotosContext.jsx` | ~600 | L1 | For a 10-rating target every extra tap is friction. Keep tier + optional one-line why; hide aspect ranking and photo upload. |
| S3 | Map screen extras: category filter panel, pin-drop placement, trip-route fit, nav overlay, test mode | `MapExplore.jsx`, `MapCategoryFilter.jsx` | ~600 of the 1,547 | L2 | The map is 1,457 lines because it also hosts routing and navigation. Keep pins, locate, picks. |
| S4 | Landmarks tab (list, "For Me" sort) | `screens/LandmarkSelection.jsx` (729), `lib/search.js` | ~900 | L1 | Useful as a "rate queue" (sorted by taste, quick-rate on every row). Strip Select All, the itinerary add, three sort modes, and category chips down to For Me + search. |
| S5 | Landmark detail extras: community comments + replies, report/block buttons, admin panels, edit-time, postcard, lightbox, admission tags | `LandmarkDetail.jsx`, `ReviewReplies.jsx` (185), `LandmarkPostcard.jsx`, `AdminEdit*Panel.jsx` | ~900 | L4 | Keep own rating, directions, check in. Community comments and replies are moderation burden with 10 testers who do not know each other. |
| S6 | Mapr tab (chat) | `screens/Mapr.jsx` (995), `lib/MaprChatContext.jsx` (435), `api/plan-ai.js` (508), `api/_lib/appHelp.js` (293) | ~2,300 | L2 | Keep one plain chat that returns place cards with Directions and the "I just left, how was it?" rating card. Hide chat list/rename/projects/sharing/edit-resend, multi-city pill, dollar cost readout, and the stacked cards above the feed (discovery stats, taste score, nudge). |
| S7 | Plan Your Trip chat wizard | `components/TripPlannerCard.jsx` (384), `ChatWizard.jsx`, `lib/tripPlanner.js` | 651 | L2 | It already writes to `recommendation_log` (source `trip-planner`) and has the usual/new split, so it is useful for the metric. Cut Solo/Group and the optional free-text step; keep location, mood, usual/new. |
| S8 | "I'd go / Not sure / Not for me" Travel Picks carousel (on the Itinerary tab) | `components/MaprPicksCarousel.jsx` (199), `lib/maprPicks.js`, `lib/pickFeedback.js` | 531 | L2, M | The ONLY place a user can say "I'd go". It is buried on Profile. Move the vote onto the Map picks cards (see Section 5), then retire this carousel. |
| S9 | Taste Profile Score card ("Mapr is still learning: 42%") | `components/TasteProfileCard.jsx` (236), `lib/tasteProfile.js` | ~330 | L1 | A leave-one-out confidence percent is hard to act on. Replace with "N/10 rated". |
| S10 | Taste nudge + preference chips + "Tell Mapr what you love" | `TasteNudgeCard.jsx` (283), `PreferenceChips.jsx`, `Settings.jsx` section | ~450 | L1 | Overlaps onboarding cards. Keep one way to state taste, in onboarding. |
| S11 | Chaining ("Because you liked...") | `nearbyPicks/BecauseYouLikedRow.jsx`, `lib/preferenceChains.js` | 111 | L2 | Keep as an invisible ranking input (it feeds `chainedPick`). Hide the separate row until the baseline match rate exists. |
| S12 | Add a landmark | `screens/AddLandmark.jsx` (658), `lib/customLandmarks.js`, `api/verify-landmark.js`, `api/_lib/enrichLandmark.js`, `api/classify-interest.js`, `places-*` | ~1,800 | L1 | Coverage safety valve: lets a tester rate a place that is not in the 1,244. Reduce to a single "Can't find it? Add it" link inside Rate-a-Landmark search; hide the pin-drop/full form and standalone route. High support cost (see R4). |
| S13 | Report a bug | `screens/ReportBug.jsx` (291), `lib/bugReports.js` | ~350 | M | Testers need one feedback channel. Keep, but as a short text box (or a mailto), reachable from Settings only. |

### 2.3 HIDE: behind a flag or out of nav, not deleted (32)

"Hide" means: remove the entry point (tab, header icon, card, Settings row), gate the route, leave the code and Firestore rules in place so it can come back.

| # | Feature | Where | LOC | Step | Why hide |
| --- | --- | --- | --- | --- | --- |
| H1 | Itinerary tab (Current/Past, search, edit list, drag reorder, recap) | `screens/Itinerary.jsx` (1,148), `lib/TripContext.jsx` (336), `itineraryStatus.js`, `useDragReorder.js`, `TripRecapCard.jsx` | ~2,480 | - | Planning is not the loop; a pick goes straight to Directions. It is the 4th of 5 tabs and the second-largest screen. |
| H2 | Create New Trip / Trip Setup modal | `screens/TripSetup.jsx` (394) | 394 | - | Same reason; also the old non-AI path. |
| H3 | Group trips (shared itineraries, members, 25 people, Places From Mapr card) | `screens/GroupTrip.jsx` (618), `lib/groupTrips.js`, `AddMemberSheet.jsx` | ~870 | - | Needs friends, and 10 testers cannot yet provide a group's worth of data. Two-person edit conflicts are a support magnet. |
| H4 | In-app turn-by-turn and route overlay | `TurnByTurnPanel.jsx`, `ActiveNavOverlay.jsx`, `lib/navProgress.js`, `lib/routing.js` (273), `api/directions.js` | ~700 | L3 | Phone Maps does this better. Drop the "Use the Map" option from the directions picker. |
| H5 | Solo streak (header flame, countdown, streak page, freeze) | `Header.jsx` StreakBadge, `lib/soloStreaks.js`, `lib/streaks.js`, `MyStreaks.jsx`, 3 API endpoints | ~1,100 | - | The "rate 3 today" rule is satisfied by Travel Picks votes, not ratings, so it does not push toward 10 ratings by day 2. Revisit after the baseline as a day-3 return nudge. |
| H6 | Dual streaks, shared freezes, recovery missions, compatibility score, streak partner push | `pairStreaks.js`, `PairStreakContext.jsx`, `api/close-streak-day.js`, `reset-dual-streak.js`, `complete-recovery-mission.js`, `use-streak-freeze.js`, `api/_lib/compatibility.js`, `StreakWarningBanner.jsx` | ~1,800 | - | Needs two engaged users to mean anything and 5 server endpoints. Largest single block outside the loop. |
| H7 | Leaderboard (weekly/monthly/yearly, regional, friends, full screen, "closest rival") | `lib/leaderboard.js` (699), `FullLeaderboard.jsx`, Profile "Ranks" | ~914 | - | Competitive points do not change what Mapr recommends. The founding doc itself calls this optional. |
| H8 | Points, levels, level-up popup, welcome bonus, referral bonuses | `lib/level.js`, `useWelcomeBonus.js`, `CelebrationOverlay.jsx`, `lib/referrals.js`, `leaderboardPoints.js` | ~500 | - | Rewards for points, not for ratings. Popups interrupt the rating flow. |
| H9 | Badges, Full Stats, My Cities, confetti | `BadgesContext.jsx` (322), `badgeStats.js`, `FullStats.jsx`, `MyCities.jsx`, `CityList.jsx`, `ConfettiBurst.jsx` | ~860 | - | Trophy-room content the founding doc parks for a later phase. |
| H10 | Friends: requests, usernames, popovers, friend stats modal, friend check-ins/cities, invite button, public/private profile, blocks | `lib/friends.js` (514), `FriendsContext.jsx`, `FriendsPanel.jsx` (339), `FriendStatsModal.jsx`, `FriendPopoverName.jsx`, `FriendCheckins.jsx`, `FriendCities.jsx`, `lib/blocks.js` | ~1,800 | - | Nothing in the loop needs a friend. Removes privacy rules, abuse reports and block UI from the tester surface. |
| H11 | In-app notifications screen + bell | `screens/Notifications.jsx` (284), `lib/notifications.js`, Header bell | ~400 | - | Its content is friend requests, group invites and the "onboarding updated" notice, all hidden or no-ops with the above. |
| H12 | Push notifications (Settings toggle, test button, device tokens) | `pushNotifications.js`, `usePushNotificationsSync.js`, `api/_lib/push.js`, `api/push-test.js` | ~270 | - | Infrastructure only: nothing meaningful is sent yet beyond streaks. Needs paid Apple setup (launch plan). |
| H13 | Habit tracking + "add to itinerary?" prompt | `HabitPlacePrompt.jsx` (219), `lib/habitTracking.js`, `habitNearby.js` | ~520 | - | Feeds the hidden itinerary. Adds a modal on top of every screen. |
| H14 | Background location ("Always" permission) + onboarding step | `lib/backgroundLocation.js`, `useBackgroundLocationSync.js`, `LocationAlwaysStep.jsx`, `ios/.../BackgroundPlaces` per launch plan | ~250 | - | Not needed for "picks when the app opens". Highest App Store review risk in the launch plan (Always location). Do after the loop works. |
| H15 | Offline map download + offline banner | `lib/offlineMap.js`, `OfflineDownloadButton.jsx`, `OfflineBanner.jsx` | ~245 | - | Founding doc lists offline mode as not in v1; testers use the app at a desk and out and about with data. Keep the tiny offline write queue (`offlineWrite.js`). |
| H16 | Themed weekly challenge | `ThemedChallenge.jsx`, `lib/challenges.js` | ~110 | - | Lives on Itinerary, so goes with it. |
| H17 | Trip Recap share card | `TripRecapCard.jsx` (87) | 87 | - | Same. |
| H18 | Mapr chat list, rename, search, projects, sharing, edit-and-resend | `MaprChatsPanel.jsx` (390), `lib/maprChats.js` (239), `MaprChatContext.jsx` parts | ~1,000 | - | One continuous chat is enough. Projects/sharing triggers notifications and share rules. |
| H19 | Mapr actions on itineraries ("add it to my itinerary", undo) | `lib/maprActions.js` (441) | 441 | - | Itinerary is hidden, so Mapr must stop offering it (and APP_HELP updated, per CLAUDE.md). |
| H20 | Time-saved / discovery stats cards | `DiscoveryStatsCard.jsx`, `lib/timeSaved.js`, `planning_events` | ~200 | - | A vanity number about planning minutes, not about whether picks were good. |
| H21 | Request a feature | `screens/RequestFeature.jsx` (296), `lib/featureRequests.js` | ~330 | - | Invites scope creep; the bug form covers tester feedback. |
| H22 | Mood carousel ("I want to eat / history / art / fresh air / a night out / sports / tech") | `nearbyPicks/MoodCarousel.jsx` (62) + logic in `nearbyPicks.js` | ~250 | L2 (extra rows) | Extra rows beyond the top 3 dilute the one metric, and are **not logged** to `recommendation_log` (only the top set is), so they cannot be measured. |
| H23 | "Time to eat?" meal card | `nearbyPicks/MealCard.jsx` (29) + logic | ~120 | L2 (extra) | Same: unlogged, time-of-day specific, hard to evaluate with 10 people. |
| H24 | Nearby favorite-kind heads-up card | `nearbyPicks/NearbyInterestCard.jsx` (20) | ~80 | L2 (extra) | Same. |
| H25 | Distance filter chips + "Show different places" refresh | `nearbyPicks/DistanceFilter.jsx`, `useNearbyPicks` refresh | ~150 | L2 | Refresh re-logs a new set each press, which inflates the match-rate denominator (Section 5). Let the app pick the radius. |
| H26 | Home address (Settings), privacy toggle, theme toggle | `Settings.jsx` sections | ~250 | - | Home address feeds trip start; privacy is for friends; theme is cosmetic. Keep Units (small) and Change password, Delete account. |
| H27 | Review photo upload + "My photos" | `MyPhotosContext.jsx`, `lib/reviews.js` photo path, storage rules | ~300 | - | Image moderation and storage cost; does not improve picks. |
| H28 | Smart search ("Mapr thinks you mean") | `lib/smartSearch.js`, `api/smart-search.js`, `SmartSearchLabel.jsx` | ~300 | - | Per-keystroke-class AI cost; local fuzzy search already forgives typos. |
| H29 | Admin tools: Admin Mode badge, in-place landmark editors | `AdminEdit*Panel.jsx`, `AdminModeContext.jsx`, `LandmarkEditsContext.jsx`, `landmarkOverrides.js` | ~560 | - | Not user facing, but it ships in the bundle and the detail page. Keep, only render for admins (already the case). |
| H30 | Test tab + Onboarding Lab | `App.jsx` TestMap, `OnboardingLab.jsx` (518), `onboardingLabConfig.js` | ~560 | - | Admin-only already. Useful for trying the new onboarding (S1) without touching testers. Keep. |
| H31 | `api/mapr-picks.js` (8 AI picks from a 30-place shortlist) | `api/mapr-picks.js` (269) | 269 | - | Not called by the client; only the admin Onboarding Lab references it. Profile's carousel is client-side. Candidate for removal, hide it for now. |
| H32 | Onboarding version notice + banner | `OnboardingBanner.jsx`, `useOnboardingNotice.js`, `onboardingVersion.js` | ~200 | - | Re-onboarding existing users is irrelevant with 10 new testers. |

### 2.4 Infrastructure, not features (leave alone)

Error boundaries, skeletons, toast, chunk-reload guard, version check, modal a11y, persistent-state drafts, offline write queue, image helpers, timezone helpers, place-photo proxy (`api/place-photo.js`), places-nearby/autocomplete/details proxies. These are neither loop features nor candidates to hide; they carry the loop.

### 2.5 Bucket counts

| Bucket | Count | Approx LOC in bucket (overlaps possible) |
| --- | --- | --- |
| KEEP | 14 | ~8,000 (of which ~2,500 core, the rest trimmed under S-items) |
| SIMPLIFY | 13 | ~11,000 before trimming, plausibly ~6,000 after |
| HIDE | 32 | ~13,000+ |
| Total user-facing features/flows | 59 | |

## 3. Risk and support burden flags

These increase risk beyond their loop value. Ordered by how much they would hurt a 10-person test.

| # | Risk | Where | Why it matters |
| --- | --- | --- | --- |
| R1 | **Check-ins are not location-verified.** `APP_HELP`: "right now the app does NOT require being near the place to check in." Founding doc says 30 m. | `CheckInContext.jsx`, `CheckInButton.jsx` | "Visit and love" is half the metric and visits cannot be trusted. Either enforce a radius, or record the distance at check-in (not currently stored: the check-in doc has `insideHomeRadius` but no distance-to-landmark). |
| R2 | **Onboarding does not produce ratings.** Swipe cards are 39 taste cues; picks unlock at 10 ratings. | `Onboarding.jsx`, `nearbyPicks.js` | A new user finishes onboarding and sees a locked sheet. Directly fails the "10 ratings by day 2" test. |
| R3 | **Onboarding blocks on a required first check-in** (`REQUIRE_FIRST_CHECKIN = true`) that has no Skip, and picks the nearest landmark to GPS regardless of distance. | `FirstCheckInStep.jsx`, `firstCheckIn.js` | A tester at a desk checks in to a place they are not at, creating a fake "visit" and a 0-signal rating prompt. Also a dead end without location. |
| R4 | **User-generated content and AI cost:** Add Landmark (public catalog writes, AI verification), community comments, replies, photo upload, reports, blocks. | `AddLandmark.jsx`, `customLandmarks.js`, `ReviewReplies.jsx`, storage rules | Moderation and abuse surface for an invitation-only test. Needed for App Store UGC rules only if comments stay public. |
| R5 | **Always-location and push** | `backgroundLocation.js`, `pushNotifications.js`, Info.plist, launch plan | Review rejection risk, needs a paid Apple account, Mac and APNs key before testing. Not needed for the loop. |
| R6 | **Streak server endpoints (7) with Firestore rules authority** | `api/*streak*`, `api/reset-dual-streak.js`, `complete-recovery-mission.js` | Heavy complexity: day-boundary and timezone logic, retries, seed migrations. Timezone and retry logic are the likeliest things to break on a tester's first day. |
| R7 | **Header is busy:** two flames, countdown, bell with badge, identity popover with points and rank | `Header.jsx` (452) | Four competing attention items above the picks sheet. |
| R8 | **Mapr tab header shows a dollar cost ("⚡ $0.0123") to every user** | `Mapr.jsx` `totalCost` | Looks like a dev leftover; invites questions. |
| R9 | **Over-stuffed Mapr screen**: stacked taste score, discovery stats, nudge, Plan Your Trip, chat bar, then chat | `Mapr.jsx` | The chat tab is also named "the app's home screen" in `BottomNav.jsx` comments while `/` is Map. Two competing "home" concepts for a new user. |
| R10 | **Stale or contradictory help text:** `APP_HELP` is ~290 lines describing Dual Streaks, projects, itinerary actions and more. Mapr will describe hidden features unless it is edited alongside any hide (CLAUDE.md rule). | `api/_lib/appHelp.js` | Hiding without updating APP_HELP is exactly the failure CLAUDE.md warns about. Budget this into every HIDE. |
| R11 | **Catalog coverage** (see Section 1): 13 of 18 regions have fewer than 100 places; Key Biscayne has 17. | `src/data/*` | Picks sheet may be empty near a tester's home. |
| R12 | **Data store split-brain for votes:** `pick_feedback` writes are best-effort with a local copy; a vote can live only in localStorage. | `lib/pickFeedback.js` | Match-rate numerator can silently be short (Section 5). |

## 4. Proposed minimal first-run experience (10 testers)

Goal: reach 10 ratings on day 1 or 2, with the first picks visible the moment the 10th rating lands.

**Surface:** 3 bottom tabs, not 5.

| Tab | Content |
| --- | --- |
| Map (home) | Pins, locate button, the picks sheet. Rate buttons on pins. |
| Rate | The Landmarks list sorted "For Me", quick-rate on every row, plus Rate a Landmark search and "Can't find it? Add it". |
| Mapr | One plain chat + "Plan Your Trip" card, place cards with Directions. |

Profile reduces to a small "You" screen reached from the header: rated count, Settings (units, delete account, sign out), Report a bug. No stats, ranks, streaks, friends.

**Flow:**

1. **Sign up and verify email** (existing). One-line promise on the sign-in screen: "Rate 10 places and Mapr starts picking for you."
2. **Location permission, with a reason** ("so Mapr can pick places near you"). Skip the Always-location step entirely.
3. **Rate 10 places, one card at a time.** Show nearby catalog places (photo, name, one tier tap: Loved it / Ok / Not for me; optional one-line why). Seed the order with the swipe-card taste (S1) so the first cards are plausible. Counter "3 of 10". Allow "Haven't been, skip" without penalty, but count only real tiers toward 10. This replaces `prompt`/`howto`/`notes` steps and the required first check-in.
4. **Land on the Map** with the picks sheet already unlocked: top 3 picks with reason and Directions, and **an "I'd go / Not for me" pair on each card** (new, see Section 5).
5. **Day 1 or 2 nudge, in-app only:** "You've rated N of 10" until reached, then "Here are 3 new picks near you".
6. **Visit and check in:** when a user checks in at a place that was a pick, the existing rate-again prompt appears; log it as the outcome.
7. **One feedback path:** Report a bug in Settings; testers can message the founder outside the app for everything else.

Everything else (Section 2.3) stays hidden for the test and returns one item at a time only if it can be tied to the metric.

## 5. What Mapr match rate needs

### 5.1 What exists today

| Source | What is stored | Where it is written | Notes |
| --- | --- | --- | --- |
| `recommendation_log/{auto-id}` | `userId`, `source` (`map-picks` or `trip-planner`), `pickType` (`usual` / `new` / null), `landmarkId`, `region`, `name`, `categories`, `fromRanking`, `isTest`, `at`, `createdAt` | `lib/recommendationLog.js`, called from `useNearbyPicks.js` (when a set is built) and `TripPlannerCard.jsx` | One row per recommended place each time a set is built. Write-once, owner-only read/delete; no admin read rule, so analysis needs the Admin SDK or a console export. Skips external (web-only) places. |
| `pick_feedback/{uid}_{landmarkId}` | `userId`, `landmarkId`, `region`, `name`, `categories`, `verdict` (`yes` / `no` / `unsure`), `at`, `near` (coords rounded to 2 decimals) | `lib/pickFeedback.js`, called from the **Travel Picks carousel on Profile** (and read by the Mapr screen and streak code) | One doc per user+landmark (overwrites). Only the carousel writes it. |
| `reviews/{uid}_{landmarkId}` | `ratingTier` (loved/ok/probably-skip), `stars`, `comment`, `categories`, `updatedAt` (no `createdAt`) | `lib/reviews.js` | Overwritten on re-rate; the earlier rating is lost. |
| `checkins/{uid}_{landmarkId}[_n]` | `userId`, `landmarkId`, `region`, `points`, `visitNumber`, `ratingOnly`, `visited`, `insideHomeRadius`, `createdAt` | `lib/CheckInContext.jsx` | `ratingOnly` check-ins are ratings without a visit. No distance to landmark. |
| `ai_call_log` | feature, model, tokens, `isTest` | `api/_lib/aiCallLog.js` | Cost, not quality. |
| Client analytics | **none** (no analytics SDK in the repo) | | No impression or tap data anywhere. |

### 5.2 What is missing (must-have before the test starts)

1. **"I'd go" on the main picks.** Votes exist only on Profile's Travel Picks (a different set: unvisited most-visited places). The picks users see when the app opens (`PickCard`, `PicksBottomSheet`) have no vote buttons, only Directions and "open landmark". So the "I'd go" half of the metric has no data for the real recommendation surface. Add `I'd go / Not for me` to the pick sheet and write to `pick_feedback`, with the set id (below).
2. **Pick identity and dedupe.** `recommendation_log` has no set id or rank and logs again on every rebuild (cache is 4 hours; "Show different places" and location changes rebuild). The same place can appear many times for one user, inflating the denominator. Add `setId`, `rank`, `shownAt`, and compute the rate per unique (user, landmark, week).
3. **Join keys and outcome windows.** Outcomes come from joining `recommendation_log` to `pick_feedback` (verdict) and `reviews`/`checkins` by `userId + landmarkId`, but `reviews` has only `updatedAt`, so a rating made before the recommendation can look like a response to it. Define: outcome counts only if its timestamp is after the recommendation `createdAt` and within N days. Also record `ratingTier` at the time of check-in as the post-visit rating (right now it overwrites the earlier one; keep the earlier rating in a `priorTier` field so "rate again" is analysable).
4. **Visit trust.** Check-ins are not verified (R1). Add `distanceMeters` to the check-in doc so "visited and loved" can require, for example, within 150 m.
5. **Chat recommendations are not logged.** Place cards from Mapr chat (`plan-ai`) never call `logRecommendations`, so any pick from the chat tab is invisible to the metric. Either log them (source `mapr-chat`) or explicitly exclude the chat from the reported rate.
6. **Unlogged surfaces:** mood rows, meal card, nearby-interest card, chained row are all rendered from the same ranker but only the composed top set is logged. Hiding them (H22 to H24) is the cheaper fix.
7. **Impressions vs. responses.** "Share of picks users say I'd go to" needs a denominator of picks *seen*. Today the log means "built", not "displayed"; a collapsed sheet counts as shown. Log `shownAt` when the sheet is expanded or scrolled into view, or restrict the denominator to picks with any action.
8. **Aggregation access.** No admin read rule or dashboard exists; the metric currently cannot be computed without a script. Add a small read-only script (Admin SDK) that exports the join and prints match rate by `pickType`, `source` and week. Do not build a dashboard for 10 testers.
9. **Exclusion filters.** Always filter `isTest == false` (already designed in `recommendationLog.js` and `aiCallLog.js`) and drop admin/founder accounts.
10. **Account age.** There is no `createdAt` on `users/{uid}`; the "10 ratings by day 2" goal needs the sign-up time. Read it from Firebase Auth metadata (`creationTime`) server side, or write it at first sign-in.

### 5.3 Definition to write down before day 1

- **Numerator:** unique (user, landmark) picks that got `verdict = yes`, OR a verified check-in (within the radius) followed by `ratingTier = loved`.
- **Denominator:** unique (user, landmark) picks that were displayed (not merely built).
- **Window:** outcome within 14 days of first display; one pick counted once.
- **Splits:** `pickType` (usual vs new), `source`, user's rating count at the time, region.
- **Secondary count (for the day-2 test):** users with `ratingTier` count of 10 or more within 48 hours of account creation, out of all testers.

## 6. Suggested order of work (not done here)

1. Make onboarding end at 10 real ratings (S1, R2, R3).
2. Add "I'd go / Not for me" and set id/rank to the Map picks (Section 5.2 items 1 to 3).
3. Hide the 32 HIDE items by removing nav and entry points; update `APP_HELP` in the same PR (R10).
4. Pick tester cities from the 100+ list or add the missing places.
5. Add the one-script metric export.

Doing 3 first would clean the surface but leave the metric unmeasurable; doing 1 and 2 first matter most.
