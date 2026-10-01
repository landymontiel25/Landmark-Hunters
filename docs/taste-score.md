# Taste score (Item 5)

## What "Taste Profile, % confident" was (the premise, checked first)

- **Where it is shown.** One place: the **Taste Profile card on the Mapr tab**
  (`src/components/TasteProfileCard.jsx`, rendered by `src/screens/Mapr.jsx`).
  It read "Mapr is still learning your taste: N%" with a progress bar. It was
  not on Profile (the in-app help text already said so). `TasteNudgeCard` is
  only the like/dislike quick-pick editor that card opens; it shows no percent.
- **How it was computed.** `computeTasteConfidence(reviews)` in
  `src/lib/tasteProfile.js`: a leave-one-out check. For each of the user's own
  ratings, predict it from their other ratings with the tag-affinity model,
  take the average closeness, multiply by a category-diversity factor (capped
  until 4 different rated categories), and round to a percent. The inputs were
  real ratings, the taste-baseline quick picks (as synthetic ratings) and
  Mapr Picks check/cross votes at half weight. It never looked at what Mapr
  actually showed, so it measured "how consistent are your ratings", not "how
  well did Mapr guess".
- **A second consumer.** `src/screens/Mapr.jsx` also calls
  `computeTasteConfidence` to switch **Insider Mode** on at 75%
  (`hasInsiderMode`). That use is unchanged: only the number on the card was
  replaced. The help text now says Insider Mode runs on Mapr's separate
  internal confidence, not the card's percentage.

The premise held (one display location, one formula, nothing blocking), so the
new score replaced the card's number.

## The new score

Pure code: `src/lib/tasteScore.js` (tests in `tasteScore.test.js`). Every number
is in `src/lib/maprConstants.js`.

### A prediction

A prediction pairs

1. the hidden guess saved with a shown pick (`recommendation_log.predicted`,
   Item 1: `positive | neutral | negative`, never put on a pick object or
   shown), with
2. the user's **newest** answer on that place: `place_scores.latestLevel`
   (a rating or a tap, whichever is newer; Items 3 and 4).

Rules for pairing (`buildPredictions`):

- The answer must be **after** the pick was shown (`latestAt > shownAt`).
- Guesses count **from the user's first rating** (`min(place_scores.ratingAt)`);
  picks shown earlier are ignored.
- Picks with `predicted: null`, test-surface picks (`isTest`) and picks made for
  a **group** request (`requestFor: 'group'`) are ignored. A group pick is not
  chosen from the user's taste, so missing it says nothing about how well Mapr
  knows them.
- One prediction per place: the latest qualifying pick shown before the answer.
  A place re-shown five times is one guess about one answer.
- Order is by when the pick was shown; "last N" is the newest N by that order.
- Because the answer is read from the place doc at the time the score is
  computed, a re-rating (or a newer tap) changes the outcome of the same
  guess.

### Credit

| result | credit | constant |
| --- | --- | --- |
| same level | 1.0 | `TASTE_HIT_CREDIT` |
| one level off | 0.5 | `TASTE_SMALL_MISS_CREDIT` |
| two levels off | 0 | `TASTE_BIG_MISS_CREDIT` |
| "place wrong, type right" | 0.5 | `TASTE_HALF_MISS_CREDIT` (= 1 - `MISS_WEIGHTS['positive>negative']`) |

**Half miss, precisely.** The place doc records `missWeight > 0` when the user
tapped "I'd go" and then rated "Didn't like it" (Item 3). That prediction
counts as half a miss (credit `TASTE_HALF_MISS_CREDIT`, never lower than its
normal credit) only while that miss still stands: `missWeight > 0`, the miss's
`outcome` equals the newest answer, the hidden guess was `positive`, and the
answer is not a hit. After a re-rating the ledger recomputes `missWeight`
(0 if no longer a miss) and the prediction goes back to normal credit. A half
miss never counts as a full hit for the 100% rule.

### The percent

`score = sum(credit over the last TASTE_WINDOW (20) predictions) / (their count) * 100`,
rounded to a whole number.

- Fewer than `TASTE_MIN_GUESSES` (5) answered predictions: **"Learning..."**
  (`state: 'learning'`, `score: null`).
- Display is capped at `TASTE_DISPLAY_CAP` (99). It shows 100 only when there
  are at least `TASTE_PERFECT_WINDOW` (100) predictions and the last 100 were
  all full hits.
- The unrounded, uncapped value is kept as `percent` for history.

### Where it shows

Only the Taste Profile card on the Mapr tab ("Mapr knows your taste: N%" or
"Learning..."). The card never shows what any pick's guess was; it only gets
the score. It reads the user's own `recommendation_log` rows (filtered to rows
with a guess) and own `place_scores`, and refreshes after an answer
(`TASTE_ANSWER_EVENT`).

## History: `users/{uid}/taste_history/{id}`

Owner-only (read, create, delete; no update). One document per snapshot:

`{ at, score (0-100 or null while learning), percent, guesses (in window),
totalGuesses, window, hits, smallMisses, bigMisses, halfMisses, baselineScore,
baselineLevel, ratingsCount, version, createdAt }`

- Written from `recordTasteAnswer` (`src/lib/tasteScoreStore.js`) after a
  rating (`reviews.js`) or a tap (`pickFeedback.js`) is saved, once things go
  quiet for `TASTE_RECOMPUTE_DELAY_MS` (2 s, so onboarding's ten ratings do one
  recompute).
- Throttle (`shouldSnapshot`): the first snapshot, then at most one per
  `TASTE_SNAPSHOT_MIN_MS` (24 h), or sooner once `TASTE_SNAPSHOT_EVERY_ANSWERS`
  (5) more ratings sit behind the score than at the last snapshot.
- `ratingsCount` (ratings behind the snapshot) is what the later admin view
  needs for "accuracy at 5/10/20/50/100 ratings" and "time to 80%/90%" (use
  `at`). `version` (`TASTE_HISTORY_VERSION`) lets old snapshots stay
  comparable if the scoring rules change.
- Snapshots are not backfilled; a user's history starts at their first
  recompute after this ships.

### Baseline

`baselineScore` / `baselineLevel`: what the score would be if Mapr had always
guessed the user's most common answer (over all their places; ties
positive > neutral > negative), scored on the same predictions with the same
credits and window. Stored for the owner's later view (Item 8) and **never
shown to users**.

## Who is this for? (`requestFor`)

Before **every** Mapr request the composer asks "Who is this for?" with two
big buttons, **Just me** and **A group** (Cancel keeps the typed text). It is
asked each time and not remembered. Entry points covered:

- typed messages, quick-reply buttons, "Ask Mapr about..." from a landmark and
  edited messages (all go through `send` in `src/screens/Mapr.jsx`);
- retry of a failed turn reuses that turn's earlier answer (not a new request);
- Plan Your Trip: "Plan my trip" on the last step opens the same two buttons
  ("Who is this plan for?"). A group plan skips the usual/new ranking and the
  cache key includes the answer. (The wizard's older "Solo / Group" trip-type
  step still decides group-trip wording and is separate.)
- A cached plan replay is not a new request and carries the answer of the
  plan it was asked with.

What is logged: `requestFor` (`'solo' | 'group'`) on the user and assistant
chat messages (stored inside `mapr_chats.messagesJson`, so no rules change was
needed) and on every `recommendation_log` row written for that request's picks.

What changes for **A group**: the client sends no taste context
(`tasteContextFor`: empty `reviews`, `interests`, `tasteIntro`, `tagScoreSummary`,
`insiderMode: false`); `api/plan-ai.js` ignores those fields for a group
request even if sent (`tasteInputsOf`), adds a "GROUP REQUEST" system block
(follow what was asked, do not use the traveler's usual taste) and leaves out
the "RATING HISTORY: none yet" line so the model does not ask about taste.
**Just me** is unchanged. Taps and check-in ratings still teach Mapr the same
either way (Item 3).

## Account deletion

`src/lib/accountDeletion.js` removes `users/{uid}/taste_history` along with
`place_scores`. `recommendation_log` rows (now with `requestFor`) were already
removed.
