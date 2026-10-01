# Re-rating and "your answer changed a lot"

Levels: positive = "I'd go" tap / "I loved it" rating; neutral = "Not sure" /
"It was ok"; negative = "Not for me" / "Didn't like it". All numbers are in
`src/lib/maprConstants.js`.

## Report first: what happened on a re-rating before this change

- **Is the old rating overwritten? Yes.** `submitReview` (src/lib/reviews.js)
  writes `reviews/{uid}_{landmarkId}` with `set(..., {merge: true})`, so a
  re-rating replaced `ratingTier`, `stars`, `highlights`, and so on in place.
  The old tier was not kept anywhere on the review.
- **What was stored:** only `updatedAt` (a server timestamp, bumped on every
  write, including comment edits). There was no `ratedAt`, no `priorTier`, no
  `priorRatedAt`. The first rating's time was lost on the first edit.
- **Tag scores on re-rating:** correct, exact undo. `planLearning` reads the
  place_scores ledger (or the legacy review for old docs), takes the old
  rating's effect off the type (tag) scores (`revertRating`, which also
  restores the count) and the old comment's deltas, then applies the new one.
  The place score is recomputed from the answers. So tags were never double
  counted, but nothing knew a re-rating had happened or how far the answer moved.
- The premise of the plan held; nothing blocked it.

## What is stored now

On `reviews/{uid}_{landmarkId}` (all optional, rules-checked):

| Field | Meaning |
| --- | --- |
| `ratedAt` | ms. Set once on the first rating; never overwritten (rules enforce it once present). An old review without it gets it on its next re-rating, copied from its `updatedAt` (no backfill job; readers use `ratedAtMs()` in `src/lib/rerating.js`, which falls back to `updatedAt`). |
| `priorTier` | The tier that a re-rating replaced. Only written when the tier actually changes, so an edit at the same tier does not overwrite it. |
| `priorRatedAt` | ms. When that old tier was given (the place ledger's `ratingAt`, else the old `ratedAt`/`updatedAt`). |
| `disagreement` | `{reason, comment, at, source}` when a two-level change was explained. `source` is `asked` (modal) or `comment` (read from the rating's own comment). Cleared (null) by a later re-rating that is not explained. Kept for the later "What happened?" study. |
| `updatedAt` | unchanged: bumped on every edit. |

On `users/{uid}/place_scores/{landmarkId}` (owner-only): `latestLevel`,
`latestSource` ('rating' | 'tap') and `latestAt` hold the **newest answer's
level** for the later taste-score item (the rating wins a tie with a tap;
the level is the answer the user gave, not the level it was scored at).
`predicted` / `outcome` / `missWeight` stay the miss record. New ledger fields
record exactly what sits on the type score so undo stays exact: `typeTier`,
`typeFrequency`, `typeFactor`, `typeDelta`, `commentTypeDeltas`, `tapPlaceOff`,
`placeRatingDelta`, `resolution`.

## When the question is asked

`disagreementCheck` (src/lib/rerating.js). The user's OWN earlier answer on the
same place is their last rating if they have one, else their tap. Two levels
apart (I'd go then Didn't like it; Not for me then I loved it; Didn't like ->
I loved it; I loved -> Didn't like) asks. One level never asks. A first rating
with no earlier answer from the user never asks (Mapr's guess is not an
answer; a miss there is scored quietly by the existing prediction code).
An earlier rating wins over a stale tap, so it is not asked again and again.

1. If the rating has a comment, `reasonFromComment` reads it with the existing
   lexicon (`commentSignals.js`): loud / crowded -> Noise or crowd, overpriced
   -> Price, bad / great food -> Food, slow or rude service -> Service. A
   negated complaint ("not loud") says nothing. A hit answers without asking,
   stored with `source: 'comment'`.
2. Otherwise the modal asks once: "Your answer changed a lot. What happened?"
   Buttons: Food, Service, Price, Noise or crowd, I changed my mind, First
   visit was a one-off, I was wrong about this type of place, Other; a note box
   (capped at `COMMENT_MAX`); Skip. One tap answers, with whatever is in the
   note box. Escape and leaving the screen count as Skip, so a save never hangs.
   The modal (`DisagreementPrompt`, portaled, reusing `modal-backdrop` /
   `modal-card`, which already clear the safe-area insets) is asked **before**
   the save by `useDisagreementAsk`, in QuickRateButton, the landmark page and
   the check-in rating (before anything is posted). The onboarding quick-rate
   step does not ask.

## How each answer counts (`planLearning`)

| Answer | Place score | Type (tag) scores |
| --- | --- | --- |
| Food, Service, Price, Noise or crowd | new answer only | unchanged: the earlier rating's (or tap's) type effect stays, the new answer adds nothing; the comment's tag effect is also kept off the type |
| I changed my mind | new answer fully | old effect out, new answer fully in |
| I was wrong about this type of place | new answer fully | same as above: the type is dropped to the new answer |
| First visit was a one-off | both answers scored as neutral | neutral |
| Skip (and Other, which gives no usable cause) | 70% new + 30% old | 70% new + 30% old, as one rating (one count) |
| (never answered) | as before this change: new replaces old | as before |

Old answer = the replaced rating, or the tap when the rating follows a tap.
When the old answer is a tap: its place effect always comes out; its type
effect also comes out unless the reason keeps the type alone. When a reason is
given it replaces the "I'd go then Didn't like it" extra penalty (the
`missWeight` fact is still recorded, except one-off, which is neutral and not a
miss). Weights: `DISAGREEMENT_NEW_WEIGHT` 0.7 / `DISAGREEMENT_OLD_WEIGHT` 0.3.
Undo is exact: deleting the rating or re-rating again takes out precisely what
the ledger says is on the type score.

## Constants added (src/lib/maprConstants.js)

`DISAGREEMENT_LEVEL_GAP` (2), `DISAGREEMENT_REASONS`,
`DISAGREEMENT_PLACE_ONLY_REASONS`, `DISAGREEMENT_FULL_REASONS`,
`DISAGREEMENT_ONE_OFF_LEVEL` ('neutral'), `DISAGREEMENT_NEW_WEIGHT` (0.7),
`DISAGREEMENT_OLD_WEIGHT` (0.3).

## Judgement calls to confirm

- "Type scores unchanged" for the place-only reasons is read as: the earlier
  type effect stays and the new answer adds none (not "remove both").
- "I was wrong about this type of place" scores the same as "I changed my
  mind" (new answer fully, on the type too); only the label differs.
- "Other" has no stated rule; it counts like Skip (70/30).
- A tap with no place_scores ledger (taps from before it existed) is not
  treated as an earlier answer for the question.
- The question is asked before saving, not after, so a save is never scored
  twice. If it is never answered (app closed), the save simply replaces the old answer.
