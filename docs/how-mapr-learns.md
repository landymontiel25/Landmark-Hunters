# How Mapr learns

Mapr learns from three signals only: ratings, taps on picks (`pick_feedback`)
and the comment on a rating. Levels: positive = "I'd go" tap / "I loved it"
rating; neutral = "Not sure" / "It was ok"; negative = "Not for me" / "Didn't
like it". All numbers are in `src/lib/maprConstants.js`.

## Audit: what the code did before this change

(a) Rating -> tag scores. `reviews.js` ran `tagScoreUpdate` inside the review
transaction, using `applyRating` / `revertRating` in `tagScores.js`: +10 loved,
+2 ok, -15 didn't like, times the visit-frequency multiplier, half value once a
tag has 5 ratings, 90-day decay, clamped to +/-100. An edited or deleted rating
took the old effect out first (this was already correct). Per-region maps on
`users/{uid}`: `tagScores`, `tagScoresAt`, `tagCounts`.

(b) Taps -> tag scores. They had an effect, but a one-shot one.
`pickFeedback.js` applied `applyVote` (+4 yes, -6 no, "Not sure" nothing) only
when the place had no prior yes/no verdict ("a place is only ever scored once").
Changing yes to no later changed nothing and nothing was ever undone. A tap did
not count as a rating behind a tag (`tagCounts` unchanged).

(c) Comments -> tag scores. Not read at all. The comment text was stored on the
review and shown to others, but no code turned it into scores. (`highlights`
chips and aspect rankings are stored too and are also not used for scoring, and
`api/classify-interest.js` only maps signup interests.) Editing a comment with
`saveMyComment` never touched the scores.

(d) Place vs type. There was no per-place score. Everything was per tag
(category id) per region; a place's only footprint was its tags. A bad
restaurant lowered "food" for every food place.

(e) Check-in rating, "Just me" vs "A group". Nothing in the code distinguishes
them today. The check-in rating goes through the same `submitReview` call,
there is no solo/group field on a check-in, and the match rate (`matchRate.js`)
counts every rating the same. (The "Solo/Group" in the code is the trip planner
and group trips, a different thing.) So the requirement already held; a test
now pins it. The later group-request-type item is not blocked.

Also noted: `users/{uid}` is readable by any signed-in user, so the type
(tag) scores are not private. Anything private had to go in a subcollection.

Nothing in the audit blocked the plan.

## What it does now

One pure function, `planLearning` in `src/lib/maprLearning.js`, used by the
review transaction (rate, edit comment, delete) and by the tap handler.

- Type score = the existing tag scores. Rating path unchanged
  (`applyRating` / `revertRating`). Taps reuse `applyVote` (now with a revert),
  comments use `applyTagDeltas` / `revertTagDeltas`.
- Place score = new, `users/{uid}/place_scores/{landmarkId}` (owner-only).
  A pure function of tap + rating + comment, so an edit just recomputes it.
- The same doc is the ledger of what was applied to the tags (`tapDelta`,
  `ratingFactor`, `commentDeltas`), so changing an answer takes the old effect
  out exactly, then applies the new one. Ratings and taps made before this
  existed are handled too (legacy fallback).
- Taps are lighter than ratings (tag +4/-6 vs +10/-15; place +4/-6 vs +20/-30).
  "Not sure" does not move tags. Taps never count as a rating behind a tag.
- Comments: `src/data/commentLexicon.js` (word list, easy to extend) read by
  `src/lib/commentSignals.js`. Longest phrase wins, each entry once per comment,
  negation within 3 words (no punctuation or "but" between). "not loud" does
  nothing; "not good food" is a weaker complaint. Capped at 4 points per tag
  and 4 tags per comment. No model is called.
- "I'd go" then "Didn't like it": the place drops an extra -20 on top of the
  rating, the type gets the rating at half strength (factor 0.5), and the doc
  records `predicted: 'positive'`, `outcome: 'negative'`, `missWeight: 0.5`
  (plus `tapAt` / `ratingAt`) for the taste-score item to read.
- Deleting a review removes the rating and comment effects; a tap stays.

## Known limits

- Decay since the old answer was applied is not recoverable, so undoing an old
  answer is approximate for old ratings (as before).
- A tap made before this change that has no place doc is only undone if this
  device still remembers it (the old verdict in local storage).
- Comments saved before this change were never counted and are not replayed.
- `rebuildTagScores` (one-time replay for old score versions) does not know
  about comments or place scores; the version is not bumped.
