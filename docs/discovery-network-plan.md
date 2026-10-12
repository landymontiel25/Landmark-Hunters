# Landmark Hunters Discovery Network Plan v2

2026-10-10 · Landy Montiel. Replaces v1 (2026-10-08, PR #609's first commit).

Landmark Hunters moves from "Mapr ranks places for you" to "Mapr matches you
with people who share your taste." Version 2 fixes the score math, adds a ramp
so each city starts as Mapr only, and reorders the privacy work.

## What changed in v2

Eight changes. Each one is marked **(v2)** where it appears below.

| # | Fix | Why | Where |
|---|---|---|---|
| 1 | Unverified tips add no finder weight. The old "verified = 0" multiplier is gone. | The old rule zeroed the whole score, so a place with one unverified tip ranked below a place with no tips. | Step 7 |
| 2 | New ramp: a city starts as Mapr only and shifts toward people as it grows. | Mapr does not know a new user's taste on day 1, and a thin city has too few finds to boost. | Step 7 |
| 3 | Reputation cap is 15 per person per city, up from 5. | "Went" alone paid 10, so the old cap of 5 hid "loved" and "saved". | Step 9 |
| 4 | A taste neighbor counts only when the neighbor score is 0.3 or more. There is no city size gate. | With about 10 tags and few users, many people look alike. | Steps 4, 5 and Phase 2 |
| 5 | GPS radius depends on place type. | A 30 m radius fails indoors and at parks and campuses. | Phase 0 |
| 6 | Check-in read limits move before Phase 2. | Follows make the check-in leak worse. | Order of work |
| 7 | The ramp is stored in `community_density/{region}`. | Each city ramps on its own. | Rules table |
| 8 | "Active user" is defined: rated or checked in during the last 30 days. | The ramp needs a clear count. | Step 7 |

## Why change: moat, pull and business model

Preference data alone is a thin moat. It gets strong when it decides whose
verified finds reach whom.

**Four problems with preference data alone**

1. Google holds more of it: location history, searches, saved places and
   reviews for billions of people.
2. Recommendations level off. After a few dozen ratings Mapr knows your taste,
   and rating 200 adds little.
3. A new user picks the app that helps on day one, not the one that is perfect
   after 50 ratings.
4. It is single-player data. Your taste profile helps you and no one else.

| | Preference data only | Discovery network |
|---|---|---|
| To copy you, a rival needs | Similar data, which Google has | Your users |
| Gets better as people join | Barely | Yes. Each discoverer helps every seeker in that city. |
| What a user loses by leaving | A tuned recommender | Followers, reputation and the people they follow |
| Weak point | A good-enough rival on day one | A city with no discoverers yet |

**Three edges to build on:** verified presence (the app knows the finder stood
at the place), local network effects (you win one city at a time), and
reputation tied to a place ("Trusted in Philly").

**Pull.** Mapr plus streaks works from day one with one user. The network
pulls harder once a city fills in. Keep Mapr and streaks running the whole
time, so nothing is lost on the way.

**Business model.** The app has no revenue code yet: no subscriptions, ads,
payments or affiliate links. The network would let you sell to local
businesses that want an engaged local audience, plus booking commissions and
creator perks. One rule protects the moat: label any paid placement and keep it
apart from real finds and from reputation.

## What the app has today

Verified presence does not exist in the code yet. Any client can set the
"verified" tag, and the code's own comment calls it "client-reported, not
server-proven."

| Area | Today (code on main) | Gap |
|---|---|---|
| Check-in verification | `REQUIRE_GPS_CHECKIN = false`. The phone writes `verification`. | Phase 0 builds a server check |
| Check-in reads | Any signed-in user reads every check-in, with distance and GPS accuracy | Privacy leak once follows exist |
| Public content | Review comments are private by default | No public, attributed tip |
| Follows | None. Friends are mutual (`friend_edges`). | One-way follows |
| People matching | Only the pair-streak "% match" | Taste neighbors |
| Reputation | Points pay only on an account's first real check-in, so levels sit near 0 | Local reputation |
| Notifications | One real push type (`streak-partner-done`) | Server-written alerts |
| Moderation | 2 reports hide content. No text filter, no admin queue, one hardcoded admin email. | App Store guideline 1.2 needs filter, report, block |
| Users | Two users in Mapr's config. Every rollout is at 100%. | Cold start comes before any city network |

**How Mapr ranks today.** Taste lives in `users/{uid}.tagScores.all`: one score
per category tag, from -100 to +100, halved every 90 days. Ratings move tags
(+10 loved, +2 ok, -15 didn't like). Pick taps move them less (+4, 0, -6).
`scorePicks` in `src/lib/maprRank/rank.js` runs four steps: distance decay, a
place-to-place similarity boost, a learned model blend, and telemetry.
Exploration slots show something new 15% to 50% of the time.

**Catalog.** 18 regions with 1,244 researched places, plus 2,218 imported
places in Miami, Philly, San Francisco, Silicon Valley and Villanova. Imported
facts cite a source URL and use no opinion words. That rule stays for the
catalog. Tips get their own layer.

## The new algorithm, steps 1 to 4: find your taste neighbors

Mapr keeps today's taste score for every place, then multiplies it by a weight
for who vouches for the place. A place nobody has tipped keeps a weight of 1,
so its score stays the same as today.

Your taste picks your neighbors. Their verified tips set each place's finder
weight. Real visits by others raise the finder's reputation, and reputation
raises the weight of the finder's next tips.

**Step 1: your taste vector.** The new module `src/lib/maprRank/neighbors.js`
turns `tagScores.all` into a vector over the category tags, scaled to -1 to 1,
with the 1.5x boost for tags you said to lean into.

```
taste vector(u) = effectiveTagScores(u) / 100
```

**Step 2: taste similarity.** Cosine similarity of two vectors, shrunk toward 0
when either person has fewer than 10 ratings. A new account cannot look like a
perfect match.

```
tasteSim(a,b) = cos(a, b) × min(1, n_a/10) × min(1, n_b/10)
```

**Step 3: rating agreement.** This reuses the pair-streak scoring. On each
place both people rated, the same answer scores 1, adjacent answers 0.5 and
opposite answers 0. It needs at least 3 shared places and shrinks toward 0
below 10.

```
agree(a,b) = average match on shared places × min(1, shared/10)
```

**Step 4: neighbor score.**

```
neighbor(a,b) = 0.6 × tasteSim(a,b) + 0.4 × agree(a,b)
```

With no shared places, use tasteSim alone. A nightly job keeps each active
user's top 50 neighbors among people with at least one live tip, per city plus
a global list, in `mapr_neighbors/{uid}`. Profiles show a "Taste match" label:
High (0.6 or more), Some (0.3 to 0.6), or nothing. No percentage, so
strangers' ratings stay private.

**(v2) Weak matches count for nothing.** With about 10 tags and few users, a
weak match can look real. A person counts as a neighbor only at a neighbor
score of 0.3 or more. Below that, the weight is 0 and nothing changes. If you
and your dad have different tastes, Mapr does not pair you. It waits until
someone matches each of you. The job runs from Phase 2 in every city.

## Steps 5 to 7: finder weight, ramp and community score

**Step 5: finder weight.** For each place, take the best single voucher among
its live, **verified** tips. Add a little for each extra distinct finder. Cap
the total at 2.0, so one viral tip cannot override your own taste. **(v2)** A
tip that failed the server check adds nothing. The place keeps a weight of 1.

| Finder is | Weight |
|---|---|
| A taste neighbor (neighbor score 0.3 or more) | 1 + 0.6 × neighbor score |
| Someone you follow | 1.4 |
| A friend | 1.3 |
| Anyone, after Phase 4 | 1 + 0.5 × their local reputation (0 to 1) |
| Each extra distinct finder | +0.1, up to +0.3 |
| Cap | 2.0 |

**Step 6: freshness.** A verified visit in the last 30 days counts 1.0. The
value falls to 0.7 at 180 days and never drops below 0.5 after a year.

**Step 7: the ramp and the community score. (v2)** Mapr does not know a new
user's taste on day 1. It learns from the first ratings. In week 1 of a city,
no verified tips or neighbors exist, so the app runs as Mapr only. The ramp
makes the shift toward people smooth.

```
ramp = min(1, active users / 100, live tips / 150)
communityWeight = 1 + (finderWeight - 1) × ramp
score(you, place) = tasteFit × communityWeight × freshness
```

- **tasteFit** is today's Mapr score: distance decay, similarity boost and
  model blend. No change.
- **Active user** means someone who rated or checked in during the last 30
  days.
- The lowest of the three numbers sets the ramp. 100 users with 5 tips gives
  nothing to boost, so tips count too.
- The 2.0 cap applies before the ramp.
- The step runs inside `scorePicks`, after the model blend, only in cities on
  `COMMUNITY_REGIONS`. Exploration stays as it is. A community find can fill an
  exploration slot.
- The nightly job writes the ramp to `community_density/{region}`. Each city
  ramps on its own.

| City stage | Ramp | What you see |
|---|---|---|
| Week 1 | 0 | Mapr only |
| 50 users, 75 tips | 0.5 | Human finds get half their pull |
| 100+ users, 150+ tips | 1 | Full Mapr plus human picks |

## Steps 8 and 9: influence events and local reputation

**Step 8: influence events.** The server records what other people do with a
finder's tip.

| Event | When | Weight |
|---|---|---|
| helpful | Someone marks the tip helpful | 1 |
| saved | Someone saves the tip | 2 |
| went | Someone makes a verified check-in at the place within 30 days of seeing the tip | 10 |
| loved | That person then rates the place "I loved it" | 5 |

**Step 9: local reputation.** The server computes it nightly, per person per
city, from distinct other people's events.

```
reputation(finder, city) = Σ over other people of min(15, that person's event weights) × decay × trust
decay = 0.5^(age in days / 180)
```

- **(v2) Cap of 15 per person.** The old cap of 5 sat below the 10 points for
  "went", so "loved" and "saved" never counted. One person can now add up to
  15 of the 18 possible points.
- **Trust** is 1.0 for an account with 3 or more verified check-ins that is
  older than 14 days. It is 0.3 for other accounts and 0.5 for the finder's
  friends.
- **Fake accounts stay weak.** A new account adds at most 15 × 0.3 = 4.5.
  Levels also need a minimum number of people, so three fake accounts cannot
  reach Local (13.5 points, below the 20 needed).
- **Half-life of 180 days.** Reputation fades without new finds.

| Level | Needs |
|---|---|
| Local | Score 20 or more, from 3 or more people |
| Trusted | Score 80 or more, from 10 or more people |
| Insider | Score 250 or more, from 25 or more people, and top 5% of the city |

Reputation feeds back into finder weight (step 5). Trusted and Insider tips can
reach seekers who do not follow the finder. Good finds bring visits, visits
bring reputation, and reputation brings reach.

**Learning.** Writing a tip teaches the author's taste like a rating comment
does, capped at 4 points per tag. Marking a tip helpful or saved counts as a
light "I'd go" at half weight. Every community pick logs who found it and its
weight, so you can compare match rate and skip rate with Mapr-only picks.

## The phased roadmap

Seven phases. Each ships alone, so the app still works if the next one never
comes. Every Mapr change goes through `src/lib/maprRank/` and reaches every
Mapr surface in the same PR, as CLAUDE.md requires.

| Phase | Name | What a user sees | Size | Done when |
|---|---|---|---|---|
| 0 | Verified presence | "Verified visit" on check-ins | 3 PRs | A real phone at a real landmark shows "Verified visit," and 80% or more of check-ins with location on verify |
| 1 | Tips | Post a tip after a verified visit. "From people who went" on each landmark. | 4 PRs | 50 live tips in the launch city from 10+ people, and no tip without a verified check-in |
| 2 | Follows and taste neighbors | Follow a discoverer. "Taste match" on profiles. | 3 PRs | 60% of active users in the launch city follow at least 1 discoverer |
| 3 | Community picks | "Found by people like you" in the Map sheet, chat and lists | 4 PRs | Community picks match at least as well as Mapr-only picks over 30 days |
| 4 | Local reputation | "Trusted in Philly." Trusted finds reach more people. | 3 PRs | 10+ Local and 3+ Trusted discoverers, and "went" events grow 4 weeks in a row |
| 5 | The loop | "3 people went because of your tip" | 2 PRs | Discoverers who get "tip went" post again within 14 days more often than those who do not |
| 6 | Feed as home | A Feed tab in cities past the density gate | 2 PRs | Day-7 retention of new users in the launch city beats the Map-home baseline |

**Phase 0: verified presence (build first).** New endpoint
`api/verify-checkin.js`, built like `api/close-streak-day.js`: sign-in check,
rate limit of 30 an hour, body validation. The server loads the place and
checks that the check-in is the caller's and under 10 minutes old, the GPS fix
is under 2 minutes old, distance is within the place's radius, and no travel
was faster than 900 km/h since the last verified check-in. On a pass, the
server writes `presence: { verified: true, distanceMeters, accuracyMeters,
verifiedAt }`. On a fail, it writes the reason ("too weak a signal," "140 m
away"). Check-ins never wait for it, and unverified ones still count for
streaks and badges.

**(v2) Radius and accuracy by place type.** A flat 30 m radius with a 50 m
accuracy limit fails indoors and at large sites. These are starting values.
Tune them on real phones during the week after Phase 0.

| Place type | Radius | Max GPS accuracy |
|---|---|---|
| Statue, building, single landmark | 30 m | 50 m |
| Museum or indoor site | 60 m | 100 m |
| Park, campus, beach, neighborhood | 150 m | 100 m |

**Phase 1: tips.** A tip is a public object, separate from reviews. Reviews
stay private-by-default taste signals. After a verified visit, the rating flow
offers "Share a tip for others?" Each tip in `tips/{tipId}` has an author,
place, the verified check-in it rests on, visit date, 10 to 280 characters,
one optional photo, up to 3 tags, a status (live, held, removed), reports and
server-kept counts. `api/post-tip.js` needs a verified email, a verified
check-in under 30 days old, a limit of 10 tips an hour and one tip per person
per place. It allows at most 2 links (none in an account's first week) and
holds flagged tips for review. The landmark page shows "From people who went"
under the sourced facts. The admin dashboard gets a Content page for held and
reported tips.

**Phase 2: follows and taste neighbors.** One-way follows of public profiles,
with no approval needed. Blocking removes follows both ways. The server writes
the counts. The nightly job builds `mapr_neighbors` (steps 1 to 4). **(v2)** A
person counts as a neighbor only at a neighbor score of 0.3 or more. Both Mapr
loaders (phone and server) read neighbors, so Phase 3 finds them everywhere.
**(v2)** The check-in read limit moves here from Phase 4: reads limited to
owner, friends and public profiles, with cross-owner queries rewritten first.

**Phase 3: community picks.** Steps 5 to 7 go live on every surface in one PR.

| Surface | Change |
|---|---|
| Map sheet "Picked for you right now" | Weighted by finders. The reason line names the finder ("Ana, verified, Taste match: High, loved this"). |
| Map sheet, new row "Found by people like you" | Places with live tips in range. Shows when 3 or more qualify. |
| Map sheet rows (Because you liked, moods, meal, nearby interest) | Same weight, no new UI |
| Mapr chat | Prompt adds tips from verified visitors with similar taste. Fixes the misleading "similar taste" wording. |
| Travel Picks | Same weight |
| Trip planner | Same weight. "Something new" gets one community find. |
| Landmark list "For Me" | Same weight, plus a "Found by people" filter chip |
| Landmark page | Tips sorted by finder weight for the viewer |
| `api/mapr-picks.js` | Delete (no caller) |

Discoverers can also share brand-new places: a verified check-in at a new Add
Landmark place offers "Share this find." An A/B test (weight on versus off)
becomes useful past about 200 active users in the launch city.

**Phase 4: local reputation.** The nightly job computes influence events and
reputation (steps 8 and 9). Points stop being the status system. Profile shows
your level in each city, and the regional board becomes "Trusted in Philly,"
ranked by reputation. Streaks stay and show days instead of points. New
badges: Founding discoverer, First find, 10 went because of you, Trusted in
{city}.

**Phase 5: the loop.** All alerts are server-written, with a settings toggle
per group.

| Alert | Trigger | Push |
|---|---|---|
| Tip went | People visited because of your tip | Yes, once a day |
| Tip helpful | New helpful marks | In-app only |
| Level up | New reputation level in a city | Yes |
| New follower | Someone follows you | In-app. Push for the first 10. |
| Follow tip | Someone you follow posted near your cities | Yes, 2 a day max |
| Nearby find | A Trusted find within 1 mile matching your taste | Yes, once a week |

**Phase 6: feed as home.** `api/feed.js` returns 30 ranked items for your city:
at most 2 in a row from one finder, at most 1 in 5 from people you follow, and
1 in 6 from Mapr's own picks marked "Mapr thinks you'd like." A Feed tab opens
first only in cities past the density gate. Elsewhere the Map stays home.

## Firestore and Storage rules changes

The server writes anything that counts: verified presence, tips, follower
counts and reputation. The rules forbid clients from writing it. Each change
ships with emulator tests in `scripts/rules-test.mjs`. The rules tests do not
run in CI today, and the rules deploy on every merge, so add an emulator job to
CI before Phase 0.

| Phase | Collection or file | Change |
|---|---|---|
| 0 | `checkins` | Clients may write only `verification: 'unverified'`. They can never set or change `presence`, and they stop writing distance and accuracy. |
| 0 | `checkins/{id}/proof` | New, server-only: the GPS proof |
| 1 | `tips` | New. Read: live and not hidden (and no block either way), or your own, or admin. Create and delete: server only. Update: add your own uid to the report list once. |
| 1 | `tip_reactions` | New, owner-only: helpful or saved |
| 1 | `recommendation_log` | Add `'landmark-page'` to the allowed surfaces, or tip impression logs fail |
| 1 | `firestore.indexes.json` | New file (none exists) plus an index deploy step in the rules workflow |
| 1 | `storage.rules` | `tip_photos/`: owner write, images under 5 MB |
| 2 | `checkins` | **(v2, moved from Phase 4)** Reads limited to owner, friends and public profiles. Cross-owner queries rewritten first. |
| 2 | `follows` | New: any signed-in user reads, server writes |
| 2 | `mapr_neighbors` | New: owner reads, server writes |
| 2 | `users` | Block client writes to `followerCount`, `followingCount`, `reputation` and `founding` in `profileFieldsOk`. Today a phone could write `followerCount: 1000000` to its own profile. |
| 3 | `community_density` | New: signed-in read, server writes. **(v2)** Also holds each city's ramp, active-user count and live-tip count. |
| 4 | `influence_events`, `reputation` | New, server only (reputation is publicly readable) |
| 4 | `leaderboard_entries` | Client writes off once points stop paying |
| 5 | `users/{uid}/private` | Add `notificationPrefs` to the allowed fields |
| 6 | `recommendation_log` | Add `'feed'` to the allowed surfaces |

## Abuse defenses and the App Store

Reputation invites gaming, so each attack has a named defense and a phase.

| Attack | Defense | Phase |
|---|---|---|
| Faking "verified" from the phone | The server writes `presence`. The rules forbid clients. | 0 |
| Spoofed GPS | Accuracy limit, fix age, impossible-travel check, Android mock flag. Later Firebase App Check (App Attest, Play Integrity). | 0 |
| Tip spam | Verified visit required, 10 an hour, 1 per place, link limits, word filter | 1 |
| Abusive tips | Filter holds them. 2 reports hide a tip. Dashboard queue. Blocks hide both ways. | 1 |
| Fake followers | Server-written counts, follow rate limit, only verified-email accounts counted | 2 |
| Sock-puppet reputation farming | **(v2)** Each person adds at most 15. New or unverified accounts count 0.3, so 4.5 at most. Levels need a minimum number of people. "Went" needs a verified check-in. | 4 |
| Friend rings | Friends count 0.5. A dashboard alert fires when friends supply most of a score. | 4 |
| Paid placement posing as tips | No paid tips. Anything sold later is labeled and kept out of reputation. | All |
| Scraping where people were | Check-in read limit (now Phase 2). Follower lists only on public profiles. | 2 |

**Fix first.** Two items from the Oct 7 nightly scan come before Phase 1: the
admin check should require a verified email (question 7), and the rules
hardening (question 14) should land before Phase 2, since follows and
reputation sit on the same data.

**App Store.** Public user content (Phase 1 on) falls under App Store Review
Guideline 1.2. The app needs a way to filter objectionable content, a way to
report it, a way to block abusive users and published contact details. Phase 1
builds the first three. `Legal.jsx` already shows a contact email, and Phase 1
adds how to report a tip.

## Launch city and cold start

Launch in Philadelphia plus Villanova as one area, and make it dense before you
build for anywhere else. The network effect is local, and the app has almost
no users yet. Philly has the most places of any region: 64 researched plus 904
imported. Villanova adds 62. A campus gives you a dense group who visit the
same places and talk to each other, the cheapest route to density. Miami (121
plus 847) is the backup if your testers live there.

**Week 1 runs as Mapr only. (v2)** The ramp starts at 0, so every pick comes
from Mapr's taste score. Human finds gain pull as the city adds active users
and live tips.

**The density gate.** The community feed becomes the main screen in a city only
when all three numbers hold for 14 days in a row. Below the gate, community
finds show as one row in the "Picked for you" sheet, and Mapr's picks stay on
top. The nightly job writes each city's numbers and gate to
`community_density/{region}`.

| Measure | Threshold |
|---|---|
| Discoverers with a verified tip in the last 30 days | 30 or more |
| Live tips on distinct places | 150 or more |
| Community items within a seeker's radius, median day | 5 or more |

**Seeding.** You and your testers post tips on places you have visited. Each
tip needs a verified check-in, so seeding means going. The first 25 people to
reach "Local" in the launch city get a permanent "Founding discoverer, Philly"
badge. It is free, and later users cannot earn it. No fake or AI-written tips.
One fake tip found in public ends the trust argument.

**The checkpoint.** After Phase 1 and a month of seeding, count tips in the
launch city. Under 50 tips from 10 people means motivation is the problem, and
Phases 2 to 6 will not fix it. Revisit the plan before you build them.

## Decisions and order of work

Nine decisions need you before building starts. Each has a recommendation.

| # | Decision | Recommendation |
|---|---|---|
| 1 | Launch city | Philly plus Villanova (Miami as backup) |
| 2 | A private profile's tips show the name, or "A verified visitor" | Show the name. Posting a tip is public, and the post screen says so. |
| 3 | Run the rules tests in CI before Phase 0 | Yes. The rules guard every phase and deploy on merge. |
| 4 | Delete `api/mapr-picks.js` in Phase 3 | Yes, no screen calls it |
| 5 | Retire points as the status system in Phase 4 | Yes. Keep streaks, showing days instead of points. |
| 6 | "Founding discoverer" badge for the first 25 Locals | Yes |
| 7 | Scan questions 7 and 14 (admin verified email, rules hardening) first | Yes |
| 8 | **(v2)** Ramp thresholds: 100 active users and 150 live tips | Yes. Adjust after the first 30 days of data. |
| 9 | **(v2)** Taste neighbors count only at a neighbor score of 0.3 or more, with no city size gate | Yes. Below 0.3, the weight stays at 1 and nothing changes. |

**Order of work**

1. Prerequisites: rules tests in CI, scan question 7, and the parts of question
   14 that touch check-ins and points.
2. Phase 0, then a week on real phones to tune radius and accuracy by place
   type.
3. Phase 1 and the dashboard Content page. Start seeding the launch city.
4. **(v2)** Check-in read limits, then Phase 2.
5. Phase 3 (the ramp goes live with it).
6. Phase 4.
7. Phase 5.
8. Phase 6, once the launch city passes the density gate.

Each phase also updates `APP_HELP` (what Mapr chat knows about the app), adds
dashboard metrics through the nightly job, and records progress in
`docs/open-work.md`.

**Other work still waiting on you.** Confirm that the old service-account key
(id `8bc84a2c…`, still in git history) is deleted in Google Cloud. Answer the
scan's 21 questions in `docs/landmark-hunters-scan-2026-10-07.md`.
