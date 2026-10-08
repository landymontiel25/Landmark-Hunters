# Discovery network: phased plan

Status: plan only, nothing built yet. Written 2026-10-08 from the code on
`main` at a5e83df. Each phase lists what to build, which Mapr surfaces change,
the exact Firestore and Storage rules changes, the abuse defenses, the
APP_HELP lines, the dashboard metrics, and the test that says the phase worked.

## 1. The vision in one paragraph

Landmark Hunters becomes the place where people find places through other
people. Discoverers post verified finds and tips, build a reputation tied to a
city ("Trusted in Philly"), and gain followers. Seekers get a feed of what
people with their taste found. Mapr stops being the source of picks and
becomes the matcher: it decides whose finds reach whom. The moat is a network
of verified visitors with known taste, which a competitor can't copy with
features.

Three edges carry the plan:

1. **Verified presence.** The app knows the finder stood at the place.
2. **Local network effects.** You win one city at a time, so cold start in
   each city is the real constraint.
3. **Reputation tied to a place.** "Trusted in Philly" signals local
   knowledge and keeps discoverers here.

## 2. What the code has today (and what it lacks)

The plan starts from these facts. Each one shapes a phase.

| Area | Today | Gap for the vision |
|---|---|---|
| Check-in verification | `REQUIRE_GPS_CHECKIN = false` (`src/lib/maprConstants.js:181`). The client writes `verification`, and the rules accept `'verified'` from any client (`firestore.rules:109-172`). The code comment says "'verified' is a client-reported tag, not server-proven." | **Edge 1 doesn't exist yet.** Phase 0 builds it. |
| Check-in writes | Client transaction in `src/lib/leaderboard.js` `_claimCheckIn` (119-230). No server endpoint. | Need a server step that checks the GPS fix. |
| Check-in reads | Any signed-in user reads every check-in, distance and GPS accuracy included. | A follow graph makes this a privacy problem (where someone was, and when). |
| Tips / public content | Review comments (≤500 chars) default to private, copied from `users.public` (`src/lib/reviews.js:36-41`). | No public, attributed tip object. |
| Follows | None. Friends are mutual (`friend_edges`). | Need one-way follows. |
| User-to-user matching | Only `computeCompatibility` (`src/lib/pairStreaks.js:266`, server copy `api/_lib/compatibility.js:18`), used for the pair-streak "% match" label. Mapr's chat prompt says "places loved by travelers with similar taste" (`api/_lib/maprChatRanking.js:76-77`), but the code behind it is place-to-place similarity. | No taste neighbors. |
| Reputation | Points pay only on an account's first real check-in (`leaderboard.js:51-58`), so levels and regional boards sit near 0 (scan question 9). Regional boards scan `checkins where region ==` on the client (`leaderboard.js:643`). | Points measure nothing useful. Replace with local reputation. |
| Notifications | No path for one user to notify another (`firestore.rules:1096-1127`). One real push type: `streak-partner-done`. | Server-written notifications for "went because of you" and "new find". |
| Moderation | Report arrays hide content at 2 reports. No text filter anywhere. No admin queue for reported content. Admin is one hardcoded email. | App Store guideline 1.2 requires filtering, reporting and blocking for public user content. |
| Users | Mapr config notes two users, with every rollout at 100% (`src/lib/maprRank/config.js`). | **Cold start is the first problem, before any city has a network.** |

Two earlier decisions this plan reverses, on purpose:

- `docs/feature-audit.md` recommended trimming comments and replies (S5) and
  shrinking Add Landmark (S12) to cut the moderation burden. The vision makes
  user content the core, so the moderation work moves into the plan instead.
- The catalog's sourcing rules (every fact cites a URL, no opinion words) stay
  for the catalog. Tips live in a separate layer where opinion is the point.

## 3. Principles for every phase

1. **The server writes anything that counts.** Verified presence, tips,
   follower counts, reputation, influence: the client asks, a server endpoint
   checks and writes with the Admin SDK, and the rules set `allow write: if
   false` on those fields or collections. This follows the existing streak
   pattern (`api/close-streak-day.js`).
2. **Two layers of content, never mixed.** Catalog facts stay sourced and
   neutral. Tips carry a name, a verified-visit mark and an opinion. The
   landmark page shows them in separate sections.
3. **Mapr backstops every empty spot.** A community surface with too little
   content in range falls back to today's Mapr picks, labeled as Mapr's.
4. **One pipeline.** Per `CLAUDE.md`, any change to how Mapr ranks, learns or
   logs goes through `src/lib/maprRank/` and reaches every surface in the same
   PR: the Map sheet and its rows, Mapr chat, Travel Picks, the trip planner,
   the landmark list's "For Me" order, and any new feed.
5. **Feature flags per city.** Community surfaces turn on by region
   (`COMMUNITY_REGIONS` in `src/lib/maprRank/config.js`), so a dead city keeps
   today's app.
6. **Each phase ships alone.** Every phase leaves the app working if the next
   one never comes.

## 4. Launch city and cold start

The network effect is local, and the app has almost no users, so pick one
area and make it dense before building for the rest.

**Recommendation: Philadelphia plus Villanova as one launch area.**

- Philly has the most places of any region: 64 curated plus 904 imported.
  Villanova adds 62 more.
- A campus gives you a dense group of people who visit the same places and
  talk to each other, which is the cheapest way to reach density.
- Miami (121 curated plus 847 imported) is the backup if your testers live
  there.

**Density gate.** The community feed becomes the main surface in a city only
when all three hold for 14 days in a row:

- at least 30 discoverers with a verified tip in the last 30 days,
- at least 150 live tips on distinct places,
- a seeker opening the Map tab in the city sees at least 5 community items
  within their radius, on the median day.

Below the gate, community items show as one row in the "Picked for you" sheet
(Phase 3), and Mapr's picks stay on top. The nightly job computes the gate
per region and writes it to `community_density/{region}` (Phase 3).

**Seeding before the gate:**

- You and your testers post tips on places you've been. Each tip needs a
  verified check-in (Phase 0), so seeding means visiting.
- A founding discoverers group in the launch area: the first 25 people to
  reach "Local" reputation get a permanent "Founding discoverer, Philly"
  badge. This costs nothing and gives early discoverers a status that later
  users can't earn.
- No fake or AI-written tips, ever. One fake tip found in public ends the
  trust argument.

## 5. The phases at a glance

| Phase | Name | What a user sees | Size |
|---|---|---|---|
| 0 | Verified presence | A "Verified visit" mark on check-ins | 3 PRs |
| 1 | Tips | Post a tip after a verified visit; "From people who went" on each landmark | 4 PRs |
| 2 | Follows and taste neighbors | Follow a discoverer; "Taste match" on profiles | 3 PRs |
| 3 | Community picks | "Found by people like you" in the Map sheet, chat and lists | 4 PRs |
| 4 | Local reputation | "Trusted in Philly"; amplification of trusted finds | 3 PRs |
| 5 | The loop | "3 people went because of your tip"; new-find alerts | 2 PRs |
| 6 | Feed as home | A Feed tab in cities past the density gate | 2 PRs |

**First feature to build: Phase 0, server-verified check-ins.** Every later
phase leans on "this person was there." Building tips or reputation on
client-reported presence would teach users that the mark means nothing, and
you'd have to reset it later.

**First feature users notice: Phase 1, tips.** It's the first new behavior,
and it produces the content every later phase ranks.

---

## 6. Phase 0: verified presence

### Goal

"Verified" means a server checked a recent GPS fix against the place's
coordinates. A client can no longer write it.

### What GPS verification can and can't prove

A rooted Android phone or an iOS simulator can fake a location. Server checks
raise the cost of faking and catch the lazy cases. They don't make faking
impossible. The defenses below stack so a faker has to work for each fake
visit. Phase 4 then makes fake visits worthless, because reputation counts
what other people do with your finds.

### Build

**New endpoint `api/verify-checkin.js`**, built on the pattern in
`api/close-streak-day.js`:

1. `withCors`, POST only, `verifyIdToken(req)` → 401 on failure.
2. `isRateLimited(req, 'verify-checkin', { limit: 30, windowMs: 3600000, id: uid })`.
3. Body: `{ checkinId, landmarkId, region, fix: { lat, lng, accuracy, timestamp, speed?, mocked? } }`.
   Validate types and ranges → 400.
4. Load the place on the server: `ALL_LANDMARKS` (`src/data/regions.js`) plus
   `ensureServerPlacePacks()` (`api/_lib/placePacks.js`) plus
   `custom_landmarks/{id}` through `adminDb()`.
5. Checks, all server-side:
   - The check-in doc exists, belongs to `uid`, and was created in the last
     10 minutes.
   - The fix's `timestamp` is within 2 minutes of server time.
   - `accuracy <= CHECKIN_MAX_ACCURACY_METERS` (50).
   - Distance from the place ≤ the place's `checkInRadiusMeters`, or 30 m.
     Large places (parks, campuses, stadiums) need their own radius;
     reuse the existing per-place field.
   - **Impossible travel:** compare with this user's last verified check-in.
     Reject when the implied speed is above 900 km/h (faster than a plane).
   - Mock locations: Android marks a faked fix (`Location.isMock()`), but
     `@capacitor/geolocation` doesn't pass that flag through. Reading it needs
     a small native addition to the Android project. Do it in a follow-up PR,
     then reject `mocked === true` here.
6. On pass, write to the check-in doc with the Admin SDK:
   `presence: { verified: true, method: 'server-gps', distanceMeters,
   accuracyMeters, verifiedAt: FieldValue.serverTimestamp(), version: 1 }`.
7. On fail, write `presence: { verified: false, reason }` so the client can say
   why ("Your GPS signal was too weak", "You're 140 m away").
8. Return `{ ok, verified, reason }`.

**Client changes:**

- `src/lib/CheckInContext.jsx` `commitCheckIn`: after `claimCheckIn` resolves,
  call the endpoint with the same fix the check-in used. The check-in itself
  doesn't wait for verification. A failed or offline verification leaves an
  unverified check-in, as today.
- Offline: queue the fix locally and retry when the connection is back. The
  server only accepts a fix whose timestamp is within 2 minutes of the
  check-in's `createdAt`, so a late retry stays honest.
- `src/lib/checkinRules.js` `checkinLocationFields`: stop writing
  `verification: 'verified'`. Write `'unverified'` always. Keep the field for
  old docs.
- Show "✓ Verified visit" on check-in cards (`CheckinsGallery.jsx`,
  `MyCheckins.jsx`, `LandmarkDetail.jsx`) when `presence.verified == true`.
- Leave `REQUIRE_GPS_CHECKIN` off. Unverified check-ins still count for
  streaks and badges as today. Only Phases 1 to 4 require verified ones.

**Privacy of check-in reads.** Today any signed-in user reads every check-in
with distance and accuracy. Before Phase 2 adds follows:

- Strip `distanceMeters` and `gpsAccuracyMeters` from the readable doc. Move
  them to a server-only subcollection `checkins/{id}/proof/main`.
- Limit `checkins` reads to the owner, friends, and accounts with
  `users.public == true`.
- This breaks `getRegionalLeaderboard` (`leaderboard.js:643`), which scans
  check-ins by region. Phase 4 replaces that board, so do the read limit in
  Phase 4's first PR, and only move the proof fields here.

### Firestore rules (Phase 0)

```
match /checkins/{checkinId} {
  // create: unchanged shape checks, plus:
  //   request.resource.data.verification == 'unverified'
  //   !('presence' in request.resource.data)
  //   remove distanceMeters and gpsAccuracyMeters from the allowed keys
  // update: the existing owner-only field list, plus:
  //   !request.resource.data.diff(resource.data).affectedKeys().hasAny(['presence'])
}
match /checkins/{checkinId}/proof/{docId} {
  allow read, write: if false;   // server only
}
```

Rules tests to add to `scripts/rules-test.mjs`:

- A client create with `verification: 'verified'` fails.
- A client create or update that sets `presence` fails.
- A client update that changes `presence.verified` fails.
- A normal unverified check-in still succeeds.
- Reading `proof/main` fails for the owner too.

### Mapr surfaces

None change in Phase 0. Store `presence.verified` so Phase 3 can weigh it.
The nightly NCF training (`api/_lib/maprNightly.js` `ncfPositives`) keeps using
all real check-ins.

### APP_HELP (`api/_lib/appHelp.js`)

Add: what "Verified visit" means (the server checked your phone's location
against the place), that it needs location on and a fix within the place's
radius, the reasons it can fail, and that unverified check-ins still count for
streaks and badges.

### Dashboard

Nightly in `api/_lib/dashboardDocs.js`: `presence_metrics/{date}` with
check-ins, verified count and rate, and fail reasons by count. Read rule:
`isDashboard()`. Show on the App metrics page.

### Done when

- Rules tests pass in the emulator.
- On a real phone at a real landmark, a check-in shows "Verified visit."
- 30 m away, outside the radius, it shows the distance reason.
- At least 80% of check-ins with location on verify. A lower rate means the
  radius or accuracy limits are wrong for real phones. Tune them before
  Phase 1.

---

## 7. Phase 1: tips (the second content layer)

### Goal

A person who visited a place can leave a short public tip. Every landmark
page shows "From people who went" below the sourced facts.

### Tip vs review

Reviews stay what they are: a private-by-default rating that teaches Mapr
your taste. A tip is a separate public object, written to help other people.
Keeping them apart avoids flipping anyone's existing private comments to
public. The rating flow offers "Share a tip for others?" after a verified
visit, prefilled from the review comment when there is one, and the user
chooses.

### Data model

`tips/{tipId}` (server-written):

| Field | Type | Notes |
|---|---|---|
| `authorUid` | string | |
| `authorName`, `authorUsername` | string | Copied at write time. A rename job updates them later. |
| `landmarkId`, `region` | string | `region` uses the check-in's field name. |
| `checkinId` | string | The verified check-in this tip rests on. |
| `verifiedVisit` | bool | Always true at launch. The field leaves room for unverified tips later. |
| `visitedAt` | timestamp | From the check-in. Lets seekers see "visited 3 days ago." |
| `text` | string | 10 to 280 characters. |
| `photoURL` | string? | One photo, optional. |
| `kind` | string | `'tip'` at launch. Room for `'find'` (Phase 3: a new place) and `'warning'` ("closed", "cash only"). |
| `tags` | string[] | Up to 3 from the `INTERESTS` ids. Mapr matches on these. |
| `status` | string | `'live'`, `'held'` (filter flagged it) or `'removed'`. |
| `hidden` | bool | true at 2 or more reports, same as reviews. |
| `reportedBy` | string[] | Same append-one-uid rule as reviews. |
| `counts` | map | `{ helpful, saved, wentBecause }`, server-maintained. |
| `createdAt`, `updatedAt` | timestamp | |

`tip_reactions/{uid}_{tipId}` (client-written): `{ uid, tipId, type:
'helpful' | 'saved', createdAt }`. A server trigger isn't available on Vercel,
so the nightly job recounts `counts` from reactions, and the client shows its
own reaction at once.

### Build

**`api/post-tip.js`** (same pattern as Phase 0):

1. Auth, `emailVerified` required, rate limit 10 tips per hour per user.
2. The check-in exists, is the author's, has `presence.verified == true`, and
   is less than 30 days old.
3. One live tip per author per place. A second post edits the first.
4. Text checks: length, at most 2 links (and none in the first week of an
   account), and the text filter below.
5. Write the tip. Return its id.

**Text filter** (`api/_lib/textFilter.js`): a word list for slurs and sexual
content, plus checks for phone numbers, emails and repeated characters. A match
sets `status: 'held'`. The author sees the tip as live; nobody else sees it
until you review it on the dashboard. An AI check through the existing
moderation path (`verify-landmark.js` has `AI_MODERATION_ENABLED`) can come
later. Start with the word list: it's free and predictable.

**`api/edit-tip.js`, `api/delete-tip.js`:** author or admin. Editing re-runs
the filter.

**Client:**

- `src/lib/tips.js`: `postTip`, `getTipsForLandmark(landmarkId)`,
  `reactToTip`, `reportTip`.
- `LandmarkDetail.jsx`: a "From people who went" section under the facts.
  Each tip shows the name, "Verified visit · 3 days ago", the text, helpful
  and save buttons, and a ⋯ menu with Report and Block. Sort by helpful count
  from distinct users, then newest.
- The rating flow (`ratingFlow.js` and the check-in review panel): after a
  verified visit, offer "Share a tip for others?".
- Profile: a "Your tips" list.
- Blocks: filter tips from blocked users in both directions on every list.
  The rules can't do this on a list query, so the client filters, and the
  Phase 3 feed endpoint filters on the server.

**Admin moderation queue.** The dashboard gets a "Content" page: held tips,
tips with 1 or more reports, and approve or remove buttons through new
`api/admin-jobs.js` actions `tip-approve` and `tip-remove`. Today no admin
queue exists for reported reviews either; add them to the same page.

### Firestore rules (Phase 1)

```
match /tips/{tipId} {
  allow read: if request.auth != null && (
      (resource.data.status == 'live' && resource.data.hidden == false
         && !exists(/databases/$(database)/documents/blocks/$(resource.data.authorUid + '_' + request.auth.uid))
         && !exists(/databases/$(database)/documents/blocks/$(request.auth.uid + '_' + resource.data.authorUid)))
      || resource.data.authorUid == request.auth.uid
      || isAdmin());
  allow create, delete: if false;          // api/post-tip.js and api/delete-tip.js
  // Reporting: append exactly your own uid once, and nothing else changes.
  // Copy the reviews rule at firestore.rules:617-623.
  allow update: if request.auth != null
      && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reportedBy', 'hidden'])
      && request.resource.data.reportedBy == resource.data.reportedBy.concat([request.auth.uid])
      && !(request.auth.uid in resource.data.reportedBy)
      && request.resource.data.hidden == (request.resource.data.reportedBy.size() >= 2);
}
match /tip_reactions/{reactionId} {
  allow read: if request.auth != null && resource.data.uid == request.auth.uid;
  allow create: if request.auth != null
      && reactionId == request.auth.uid + '_' + request.resource.data.tipId
      && request.resource.data.keys().hasOnly(['uid', 'tipId', 'type', 'createdAt'])
      && request.resource.data.uid == request.auth.uid
      && request.resource.data.type in ['helpful', 'saved']
      && request.resource.data.createdAt == request.time;
  allow delete: if request.auth != null && resource.data.uid == request.auth.uid;
}
```

A list query must match the read rule, so `getTipsForLandmark` queries
`where('landmarkId', '==', id).where('status', '==', 'live').where('hidden', '==', false)`.
Blocks on lists stay a client filter. The query needs a composite index
(`landmarkId`, `status`, `hidden`). The repo has no `firestore.indexes.json`
yet, and `.github/workflows/deploy-firestore-rules.yml` deploys rules only.
Add the file and a `firebase deploy --only firestore:indexes` step to that
workflow in this PR, so indexes live in git like the rules.

**`storage.rules`:** `tip_photos/{landmarkId}/{uid}_{ts}.jpg`, owner write,
images only, under 5 MB, same as `review_photos`.

**Account deletion** (`src/lib/accountDeletion.js`): delete the user's tips,
reactions and tip photos. Add to the deletion test.

Rules tests: a client can't create a tip; a stranger can't read a held tip; a
blocked user can't read a single tip; a reporter can append only their own uid,
once; a reaction with another uid fails.

### Mapr surfaces

None rank tips yet. Mapr learns from them, through the shared pipeline:

- **Writing a tip** teaches the author's taste like a rating comment does:
  run the tip text through the existing comment word list (`planLearning`,
  `src/lib/maprLearning.js`, capped at 4 points per tag).
- **Marking a tip helpful or saved** counts as a light "I'd go" on that place
  for the reader: `TAP_TAG_DELTA.yes` at half weight, through `planLearning`.
- Log tip impressions in `recommendation_log` with a new source
  `'landmark-tips'` so Phase 3 can measure them. Add `'landmark-page'` to
  `SURFACES` (`src/lib/maprConstants.js:6`) and to the allowed surfaces in
  the `recommendation_log` create rule (`firestore.rules:765`).

### APP_HELP

Add: what a tip is, who can post (verified visit in the last 30 days, verified
email), length limit, where tips show, helpful and save, reporting and
blocking, one tip per place per person, and that tips are public even when the
profile is private. **Decision for you:** should a private profile's tips show
the name, or "A verified visitor"? Recommendation: show the name. A tip is a
public act, and the app should say so on the post screen.

### Dashboard

`ugc_metrics/{date}`: tips posted, live, held, removed, reports, distinct
authors, tips per region, helpful and saved counts. `isDashboard()` read rule.
Content page as above.

### Done when

- 50 live tips in the launch area from at least 10 authors.
- Held-tip review on the dashboard takes under a day.
- No tip without a verified check-in exists (a nightly check counts them; the
  number must be 0).

---

## 8. Phase 2: follows and taste neighbors

### Goal

You can follow a discoverer. Mapr learns which people share your taste, and
shows a "Taste match" label on profiles.

### Follows

`follows/{followerUid}_{followeeUid}`: `{ follower, followee, createdAt }`.

- Anyone can follow a public profile. A private profile can't be followed;
  friends already see each other.
- Following needs no approval. Blocking removes the follow both ways
  (`api/block-user.js` handles the cleanup, since a client can't delete
  someone else's follow doc).
- Counts: `users/{uid}.followerCount` and `followingCount`, written by the
  nightly job and by `api/follow.js`. Never by the client.
- Profile screen: Follow button, follower count, "Followers" and "Following"
  lists, and the person's tips.
- Friends and follows coexist. Friends are mutual and private-ish (streaks,
  group trips). Follows are public and one-way (discovery).

**`api/follow.js`** (`{ followee, follow: true|false }`):
rate limit 60 per hour; check the followee's profile is public and no block
exists either way; write or delete the follow doc; increment counts with
`FieldValue.increment`.

### Taste neighbors

Today, taste is a global tag map, `users/{uid}.tagScores.all` (`GLOBAL_TASTE`,
`src/lib/tagScores.js:65`), capped at ±100 and halved every 90 days. Use it
directly.

**New module `src/lib/maprRank/neighbors.js`** (pure, shared by client and
server):

- `tasteVector(profile)`: `effectiveTagScores` over the `INTERESTS` ids,
  scaled to −1..1.
- `tasteSimilarity(a, b)`: cosine of the two vectors, shrunk toward 0 when
  either user has fewer than 10 ratings (`sitewideTagCounts`): multiply by
  `min(1, n/10)` for each side.
- `ratingAgreement(aReviews, bReviews)`: reuse `computeCompatibility`'s scoring
  (same 1 / 0.5 / 0), but with a minimum of 3 shared places instead of 10,
  and shrink toward 0 below 10.
- `neighborScore = 0.6 × tasteSimilarity + 0.4 × ratingAgreement` when there
  is agreement data, else `tasteSimilarity` alone.

**Nightly job** (add to `api/_lib/maprNightly.js`): for each user active in
the last 60 days, compute the top 50 neighbors among users with at least one
live tip, separately for each region the user has been active in plus a
global list. Write `mapr_neighbors/{uid}`:
`{ global: [{uid, score}], byRegion: { philly: [...] }, computedAt }`. At a
few hundred users this is a few seconds of work. At 50,000 users it needs
bucketing by region first; note that in `docs/open-work.md` when you start.

**"Taste match" label** on another user's profile: High (score ≥ 0.6), Some
(0.3 to 0.6), or nothing. Don't show a percentage: it invites comparison and
reveals more about a stranger's ratings than a label does. Compute it on the
client from both public tag maps.

**Privacy check:** `tagScores` sits on the public `users/{uid}` doc, readable
by any signed-in user. A label computed from it reveals nothing new. If you
ever move `tagScores` to the private doc, compute the label on the server.

### Firestore rules (Phase 2)

```
match /follows/{followId} {
  allow read: if request.auth != null;
  allow write: if false;                    // api/follow.js and api/block-user.js
}
match /mapr_neighbors/{uid} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;
}
// users/{uid}: add the server-owned fields to the denylist in profileFieldsOk
// (firestore.rules:209). Today it blocks only a short list, so without this a
// client could write followerCount: 1000000 to its own profile.
//   !d.keys().hasAny(['isAdmin', ..., 'followerCount', 'followingCount',
//                     'reputation', 'founding'])
// The check must use the CHANGED keys for existing docs, or old docs that
// already carry the server field could never be updated by the owner:
//   !changed.hasAny(['followerCount', 'followingCount', 'reputation', 'founding'])
```

Rules tests: a client can't create a follow doc; a client can't change
`followerCount` on its own profile; the owner can still update its other
profile fields when the doc already has `followerCount`; a stranger can't
read your `mapr_neighbors`.

### Mapr surfaces

Neighbors aren't used for ranking until Phase 3. Load them in the shared
loader now, so every surface has them in one place:
`loadMaprModels` (`src/lib/maprRank/modelStore.js:65`) and `loadServerModels`
(`api/_lib/maprServerModels.js:28`) both read `mapr_neighbors/{uid}` and
return `models.neighbors`. Same 12-hour cache.

### APP_HELP

Add: following (public profiles only, no approval, blocking removes it),
follower lists, the "Taste match" label and what it's based on.

### Dashboard

`social_metrics/{date}`: follows created, users with 1 or more followers,
median followers of discoverers, neighbor list coverage (share of active users
with at least 5 neighbors in their main region).

### Done when

- 60% of active users in the launch area have at least 5 neighbors with tips.
- The "Taste match" label agrees with intuition when you and two testers rate
  the same 20 places (a hand check: people you know have similar taste come
  out High).

---

## 9. Phase 3: community picks ("Found by people like you")

### Goal

Every Mapr surface can rank community finds next to catalog places, weighted
by who found them. The Map sheet gets a "Found by people like you" row.

### The community score

**New module `src/lib/maprRank/community.js`** (pure, shared):

```
communityScore(place, ctx) =
    tasteFit(user, place)            // today's tasteScorer, unchanged
  × finderWeight(tips on the place)  // who vouches for it
  × freshness(newest verified visit) // places change
  × verifiedFactor                   // 1.0 verified, 0 unverified (launch)
```

- `finderWeight`: over the place's live tips, take the best of:
  - `1 + 0.6 × neighborScore(finder)` for a taste neighbor,
  - `1.4` for someone you follow,
  - `1.3` for a friend,
  - `1 + 0.5 × localReputation(finder, region)` once Phase 4 exists (0..1).

  Then add `0.1` for each extra distinct finder, capped at `+0.3`. Cap the
  total at `2.0` so one viral tip can't swamp your own taste.
- `freshness`: 1.0 for a visit in the last 30 days, falling to 0.7 at 180 days,
  0.5 floor after a year.
- A place with no live tips has `finderWeight = 1`, so the formula reduces to
  today's ranking. This makes the change safe to wire everywhere at once.

**Wire it into `rank.js` `scorePicks` (`src/lib/maprRank/rank.js:50`) as a
new step after the NCF blend:** multiply by `finderWeight × freshness` when
`ctx.communityTips` is present and the region is in `COMMUNITY_REGIONS`. Add
a fallback code `community-off` and telemetry fields
`community: { finders, topFinder, weight }` on each pick (`rank.js:141-151`).
Exploration (`planExploration`) stays as it is; a community find can be an
exploration slot.

**Where the tips come from.** Each surface needs the live tips for the places
it ranks:

- Client: `src/lib/tips.js` `loadRegionTips(region)` reads up to 500 live tips
  for the region, cached 30 minutes, keyed by `landmarkId`. Past 500, page by
  `counts.helpful`.
- Server: `api/_lib/maprServerModels.js` gets the same through the Admin SDK
  for chat.

**New places from tips.** A discoverer can add a place the catalog lacks:
Add Landmark already creates `custom_landmarks` docs. Phase 3 links the two:
after a verified check-in at a new custom landmark, the post-tip screen offers
"Share this find". The tip's `kind` becomes `'find'`. Custom landmarks still
need moderation (today `status: 'pending'` is never read and 2 reports hide
it); the dashboard Content page from Phase 1 lists new custom landmarks with
a find tip.

### Every surface, one PR (per `CLAUDE.md`)

| Surface | Entry | Change | Logged as |
|---|---|---|---|
| Map sheet "Picked for you right now" | `useNearbyPicks.js:119` → `rankNearbyCandidates` (`nearbyPicks.js:453`) → `scorePicks` | Pass `communityTips`; reason line shows "Ana (verified, Taste match: High) loved this" when a tip drives the pick | `map-sheet` / `map-picks`, plus telemetry |
| Map sheet: new row "Found by people like you" | `MapPicksOverlay.jsx` `rankRow` (229-231) | Candidates: places with live tips within the sheet's radius, ranked by `rankPlaces`. Row shows only when 3 or more qualify. | `map-sheet` / `community` |
| Map sheet rows: Because you liked, moods, meal, nearby interest | `rankRow` → `rankPlaces` | Same weight, no new UI | existing sources |
| Mapr chat | `api/plan-ai.js:577-586` → `chatRanking` (`maprChatRanking.js:38`) | Server loads tips; top-15 prompt lines add "TIP from a verified visitor with similar taste: …" (text, no names unless the user asks). Fix the misleading "travelers with similar taste" wording (`maprChatRanking.js:76-77`) to describe what the code does. | `chat` |
| Travel Picks | `MaprPicksCarousel.jsx:170` → `rankPlaces` | Pass `communityTips` | `travel-picks` |
| Trip planner "The usual" / "Something new" | `TripPlannerCard.jsx:228-238` → `rankTripPicks` (`tripPlanner.js:84`) | Pass `communityTips`. "Something new" gets the community row's top find as one slot when available. | `mapr-tab` / `trip-planner` |
| Landmark list "For Me" | `LandmarkSelection.jsx:491` → `rankPlaces` | Pass `communityTips`. Add a "Found by people" chip that filters to places with live tips. | not logged today; leave as is |
| Landmark page | `LandmarkDetail.jsx` | Tips sorted by `finderWeight` for the viewer instead of helpful count alone | `landmark-page` / `landmark-tips` |
| `api/mapr-picks.js` | no caller | Scan question 3 asks whether to delete it. Recommendation: delete it in this PR and remove it from `CLAUDE.md`'s surface list. | n/a |

**Learning from community picks.** A tap or rating on a community pick runs
through `planLearning` as today. It also writes an influence event (Phase 4)
when the pick came from a tip.

**Measurement.** The A/B setup exists (`experiments.js` `variantFor`). Add an
experiment `community_weight` with control (weight off) and treatment, salted
per user. With two users today it means nothing; it starts to mean something
past 200 active users in the launch area. Compare match rate and skip rate
(`api/_lib/dashboardDocs.js` `mapr_metrics`) between arms.

### Density computation

Nightly: `community_density/{region}` with discoverers (30 days), live tips,
distinct places with tips, the median community items within 3 miles of
seekers' last known locations, and `gate: true|false` per section 4.
Readable by any signed-in user (the app reads `gate` to decide layout),
server-written.

### Firestore rules (Phase 3)

```
match /community_density/{region} {
  allow read: if request.auth != null;
  allow write: if false;
}
```

`recommendation_log` rules pin the allowed surfaces at `firestore.rules:765`
(`['map-sheet', 'mapr-tab', 'chat', 'travel-picks']`). Add `'landmark-page'`
there in the same PR that adds it to `SURFACES`, or every tip impression write
fails. The `source` field isn't pinned, so `'community'` and `'landmark-tips'`
need no rules change. (Phase 1 logs tip impressions, so this list change
belongs in Phase 1's PR.)

### APP_HELP

Add: the "Found by people like you" row, how Mapr weighs finds (taste match,
people you follow, friends, verification, how recent), that Mapr's own picks
fill in when a city has few tips, and that chat can mention tips.

### Dashboard

On the Mapr page: community share of shown picks, match rate and skip rate on
community picks vs Mapr-only picks, and the `community_weight` experiment.
On a new Community page: the density gate per region over time.

### Done when

- In the launch area, community picks match at least as well as Mapr-only
  picks (match rate within 2 points or better) over 30 days.
- The row shows for at least half of sessions in the launch area.

---

## 10. Phase 4: local reputation ("Trusted in Philly")

### Goal

A discoverer earns a reputation in a city from what other people do with
their finds. Reputation replaces points as the status system, and trusted
finds reach more people.

### Influence events

`influence_events/{autoId}` (server-only): `{ finderUid, actorUid, tipId,
landmarkId, region, type, weight, createdAt }`.

| Event | When | Weight |
|---|---|---|
| `helpful` | actor marks the tip helpful | 1 |
| `saved` | actor saves the tip | 2 |
| `went` | actor makes a **verified** check-in at the place within 30 days after seeing the tip (the `recommendation_log` row or a `tip_reactions` save proves they saw it) | 10 |
| `loved` | actor rates the place `highly-recommend` after `went` | 5 |

The nightly job creates `went` and `loved` by joining verified check-ins with
recent tip impressions. Each tip's `counts.wentBecause` comes from these.

### Reputation score

`reputation/{uid}_{region}`: `{ uid, region, score, level, tipsLive,
wentBecause, distinctActors, updatedAt }`, computed nightly.

```
score = Σ over distinct actors a:
          min(5, Σ weight of a's events for this finder) × decay(age) × trust(a)
```

- **Per-actor cap of 5:** one fan, or one sock puppet, adds at most 5.
- **decay:** half-life of 180 days. Reputation must be kept up.
- **trust(a):** 1.0 when the actor has 3 or more verified check-ins and an
  account older than 14 days; 0.3 otherwise. Friends of the finder count 0.5.
  New accounts and friend rings can't carry anyone.
- **Levels:** Local (score ≥ 20 and 3 or more distinct actors), Trusted (≥ 80
  and 10 or more distinct actors), Insider (≥ 250 and 25 or more distinct
  actors, and in the top 5% of the region). Insider is relative, so it stays
  rare as a city grows.
- `users/{uid}.reputation`: a small map of `{ region: level }` for display,
  server-written.

### Amplification

- `finderWeight` (Phase 3) gains the reputation term:
  `1 + 0.5 × min(1, score / 250)`.
- A tip by a Trusted or Insider finder can reach seekers who aren't neighbors
  or followers: the community row may fill one of its slots from the region's
  top tips by reputation, ranked by the seeker's taste fit.
- Landmark page: tips by Trusted and Insider finders sort first and carry the
  badge.

### Replace points

Points measure nothing today (scan question 9). This phase retires them as
the status system:

- **Profile:** replace "Your Stats" points and level with "Your cities": your
  level in each city, tips live, people who went because of you.
- **Leaderboard:** the regional board becomes "Trusted in Philly", ranked by
  reputation score from `reputation` docs. One indexed query; no more scanning
  check-ins. The global board ranks Insider count across cities. The friends
  board shows friends' levels.
- Keep `leaderboard_entries` and points in the data for history; stop showing
  them. Streak points stop paying. **Decision for you:** keep streaks as a
  separate habit feature (recommended: yes, they bring people back), but show
  streak days, not points.
- Badges stay. Add: "Founding discoverer, {city}", "First find", "10 went
  because of you", "Trusted in {city}".

This is also when the `checkins` read limit from Phase 0 lands, since the
regional board no longer needs to scan other people's check-ins.

### Firestore rules (Phase 4)

```
match /influence_events/{id} { allow read, write: if false; }
match /reputation/{id} {
  allow read: if request.auth != null;
  allow write: if false;
}
match /checkins/{checkinId} {
  allow read: if request.auth != null && (
      resource.data.userId == request.auth.uid
      || exists(/databases/$(database)/documents/friend_edges/$(request.auth.uid + '_' + resource.data.userId))
      || get(/databases/$(database)/documents/users/$(resource.data.userId)).data.get('public', false) == true
      || isAdmin());
}
```

Two cautions on the check-in read rule:

- A list query must prove every result passes, so `getUserCheckins(uid)` for
  a friend still works (one owner), but any query across owners must be
  removed first. Search `src/` for `collection(db, 'checkins')` and rewrite
  each cross-owner query before deploying.
- `region_stats` bumps check `checkins/{uid}_{landmark}` exists for the
  caller's own doc; that still passes.

`leaderboard_entries` writes: switch to `allow write: if false` once the
client stops writing points, and pay any remaining server awards
(`awardLeaderboardPointsServer`) only where you keep them.

Rules tests: a client can't write reputation or influence events; a stranger
can't read a private user's check-ins; a friend can; the owner can.

### Mapr surfaces

Same table as Phase 3. The reputation term flows through `finderWeight`, so
the change lives in `src/lib/maprRank/community.js`, and every surface picks
it up. Add `reputation` to the telemetry on each pick. The chat prompt line
gains "(Trusted in Philly)" when that applies.

### APP_HELP

Rewrite the points, levels and leaderboard sections: how reputation works,
the three levels, what counts (other people saving and visiting), that friends
count less, that it fades without new finds, and what happened to points.

### Dashboard

`reputation_metrics/{date}` per region: users at each level, `went` events,
the share of `went` events from friends (a collusion signal), and the top
finders for your review. An alert when one actor accounts for more than 30%
of a finder's score.

### Done when

- At least 10 Local and 3 Trusted discoverers in the launch area.
- `went` events grow week over week for 4 weeks.
- No reputation where most of the score comes from friends or new accounts
  (check the dashboard alert list by hand).

---

## 11. Phase 5: the loop (notifications)

### Goal

Discoverers hear when their finds matter. Seekers hear when someone they
follow or trust posts nearby.

### Build

All server-written, through the Admin SDK into `notifications` and push
through `sendPushToUser` (`api/_lib/push.js`). No client path to notify
another user.

| Type | Trigger | Push? | Limit |
|---|---|---|---|
| `tip_went` | nightly: new `went` events for your tips | yes: "2 people went to Federal Donuts because of your tip" | one per day, batched |
| `tip_helpful` | nightly: new helpful marks | no, in-app only | batched |
| `reputation_level` | nightly: level up in a city | yes | per event |
| `new_follower` | `api/follow.js` | in-app; push only for the first 10 followers | batched daily after 10 |
| `follow_tip` | `api/post-tip.js`: someone you follow posted, near a city you've been to | yes, if within 25 miles of your last known city | 2 per day |
| `nearby_find` | nightly: a Trusted find within 1 mile of your home or last location, matching your taste | yes | 1 per week |

Settings: one toggle per group (my finds, people I follow, nearby finds).
Store in `users/{uid}/private/main.notificationPrefs` (add the key to the
`hasOnly` list at `firestore.rules:277`).

`src/screens/Notifications.jsx` renders the new types with a tap target (the
tip, the landmark or the profile).

### Firestore rules (Phase 5)

The Admin SDK bypasses rules, so the server needs no change. Clients:

- `notifications` read and the owner's `read` update stay as they are.
- Add `notificationPrefs` to the private doc's `hasOnly` list.
- `type` values aren't pinned for owner reads, so no change there. If the
  create rule pins `type` for any client path, leave the new types out of
  it: only the server creates them.

### APP_HELP

Add each notification type, the toggles, and the daily and weekly limits.

### Done when

- Discoverers who get a `tip_went` notification post another tip within 14
  days at a higher rate than those who don't (dashboard comparison).

---

## 12. Phase 6: the feed becomes home (dense cities only)

### Goal

In a city past the density gate, a Feed tab is the first thing you see.

### Build

- `api/feed.js`: auth, rate limit; returns 30 items for the user's current
  city: tips and finds ranked by `communityScore`, with a mix rule of at most
  2 items in a row from one finder, at most 1 in 5 from people you follow
  (to avoid a pure following feed), and 1 in 6 from Mapr's own picks marked
  "Mapr thinks you'd like" for exploration. Server-side block filtering.
  Cursor paging.
- `src/screens/Feed.jsx`: cards with the tip, place photo, finder, "Verified
  visit · 3 days ago", reputation badge, taste match label, distance, and
  I'd go / Save / Directions.
- `BottomNav.jsx`: when `community_density/{region}.gate == true` for the
  user's current city, show Feed first and open it on launch. Otherwise keep
  Map as home (`src/App.jsx` route `/`).
- Log feed impressions with surface `'feed'` and source `'community-feed'`.
  Add `'feed'` to `SURFACES` and to the allowed surfaces at
  `firestore.rules:765`.

### Mapr surfaces

The feed is a new Mapr surface. It ranks through `rankPlaces` with
`communityTips`, exploration through `planExploration`, and logging through
`useShownLogger`. Add it to `CLAUDE.md`'s list of Mapr surfaces in the same
PR.

### APP_HELP

Add the Feed tab: when it appears, what's in it, the mix of people and Mapr.

### Done when

- Day-7 retention of new users in the launch area beats the Map-home baseline
  (the `community_weight` experiment's split works here too).

---

## 13. Abuse defenses, all phases

| Attack | Defense | Phase |
|---|---|---|
| Fake "verified" from a client | Server writes `presence`; rules forbid the client | 0 |
| Spoofed GPS | Accuracy limit, fix age, impossible-travel check, Android mock flag; later App Check with App Attest / Play Integrity | 0 (App Check later) |
| Tip spam | Verified visit required, 10 per hour, 1 per place, link limits, word filter, new-account link ban | 1 |
| Abusive tips | Word filter → held; 2 reports hide; dashboard queue; block hides both ways | 1 |
| Fake followers | Counts are server-written; follow rate limit; only verified-email accounts count toward the displayed follower count | 2 |
| Reputation farming with sock puppets | Per-actor cap of 5, low trust for new or unverified actors, `went` needs a verified check-in | 4 |
| Friend rings | Friends count 0.5; dashboard alert when friends supply most of a score | 4 |
| Paid placement disguised as tips | Policy: no paid tips. If you sell placement later, label it and keep it out of reputation. | all |
| Scraping followers or check-ins | Phase 4 check-in read limit; follower lists only for public profiles | 2, 4 |

The rules hardening in scan question 14 (landmark averages, streak creates,
backdated `pick_feedback`, free points, `users` listing, many usernames per
account) should land before Phase 4, since reputation sits on top of the
same data. Scan question 7 (`isAdmin()` without `email_verified`) should land
before Phase 1, since the admin account gains a moderation queue.

## 14. App Store

Public user content (Phase 1 on) falls under App Store Review Guideline 1.2.
It requires a way to filter objectionable material, a way to report it, a way
to block abusive users, and published contact information. Phase 1 covers
the first three. `Legal.jsx` already shows `CONTACT_EMAIL`; Phase 1's PR adds
a line there on how to report a tip, and the review notes in
`docs/IOS_APP_STORE_LAUNCH.md` describe the filter, report and block flow.

## 15. Testing in every phase

- **Unit tests** (`npm test`): every pure function in `community.js`,
  `neighbors.js`, the reputation formula, and the text filter, with the
  edge cases named above (per-actor cap, friend weight, no tips = today's
  ranking).
- **Rules tests** (`scripts/rules-test.mjs` in the emulator): the cases listed
  in each phase. Today this script isn't in CI. **Decision for you:** add an
  emulator job to `.github/workflows/ci.yml` before Phase 0 (recommended: the
  rules are the security boundary for every phase, and they auto-deploy on
  merge).
- **API tests**: each new endpoint gets a test with a mocked `adminDb`, like
  the existing `api/*.test.js` files.
- **A real phone at a real place** for Phase 0 and Phase 1 before merging.

## 16. Decisions for you

1. Launch area: Philly plus Villanova (recommended) or Miami.
2. Private profiles' tips: show the name (recommended) or "A verified visitor".
3. Rules tests in CI before Phase 0: yes (recommended).
4. Delete `api/mapr-picks.js` in Phase 3: yes (recommended, scan question 3).
5. Points: retire as status in Phase 4 (recommended), keep streaks as a habit
   feature without points.
6. Founding discoverer badge for the first 25 Locals in the launch area: yes
   (recommended).
7. Scan questions 7 and 14 (admin verified email, rules hardening) as
   prerequisites: yes (recommended).

## 17. Order of work

1. Prerequisites: rules tests in CI; scan question 7; the parts of scan
   question 14 that touch check-ins and points.
2. Phase 0 (verified presence), then a week on real phones to tune radius and
   accuracy.
3. Phase 1 (tips) and the dashboard Content page. Start seeding the launch
   area.
4. Phase 2 (follows, neighbors).
5. Phase 3 (community picks on every surface).
6. Phase 4 (reputation, retire points, check-in read limit).
7. Phase 5 (notifications).
8. Phase 6 (feed as home) when the launch area passes the density gate.

Phases 0 and 1 are the commitment. After Phase 1, the tip count in the launch
area tells you whether people want to share. Under 50 tips from 10 authors
after a month of seeding means the problem is motivation, and Phases 2 to 6
won't fix it; revisit the plan before building them.
