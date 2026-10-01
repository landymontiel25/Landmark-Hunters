# Pick buttons (Item 7)

## What the Travel Picks carousel actually had (found first)

Profile > "Mapr Travel Picks" (`src/components/MaprPicksCarousel.jsx`) always had THREE buttons per card, not two.
Order on the card, with the exact labels and emoji:

| Button | Emoji | Label | Saved verdict | Level |
| --- | --- | --- | --- | --- |
| left | `✕` | Not for me | `no` | negative |
| middle | `🤷` | Not sure | `unsure` | neutral |
| right | `✓` | I'd go | `yes` | positive |

So the labels match what the owner expected; two details differ from the brief: "I'd go" and "Not for me" use the check and cross
marks (not a thumbs or other emoji), and the order on the card is Not for me, Not sure, I'd go. "Not sure" carried a second line
of small text under it: "Ask me again in a week" (also in its tooltip). That is gone now.

Where a tap was saved before this change: `setPickFeedback` (`src/lib/pickFeedback.js`) wrote localStorage FIRST
(`lh-pick-feedback:{uid}`), updated the screen, and then tried Firestore `pick_feedback/{uid}_{landmarkId}` best effort with
the error swallowed. So the carousel taps did reach the database when the write worked, but a failed or offline write left the
vote only on the phone, silently (R12 in `docs/feature-audit.md`). Fixed (below).

## What "Ask me again in a week" controlled

Nothing. It was a label only. What decides when a Not sure place comes back is `votedIds()` in `pickFeedback.js`: a `unsure`
vote hides the place from the Travel Picks carousel for `UNSURE_SNOOZE_MS` (7 days, an existing constant in `pickFeedback.js`),
measured from the vote's `at`; after that it can return. `yes` and `no` hide it for good. That behavior is unchanged.
Only the carousel filters on votes; the Map sheet and Mapr tab do not use `votedIds` (a place voted on can be re-picked there by
the nearby-picks engine; not changed here).

## What changed

- One shared component, `src/components/PickVoteButtons.jsx` (labels/emoji exported as `VOTE_COPY`), used by the Profile carousel,
  the Map sheet cards and rows (`PicksBottomSheet` via `PickCard` / `PickRow` `voteSlot`), and the Mapr tab / chat stop cards
  (`src/screens/Mapr.jsx`). The Mapr tab's planner picks and the chat suggestions are the same stop-card render path; the surface
  (`mapr-tab` vs `chat`) is decided by the pick marks, as before. 44px targets, `role="group"`, `aria-pressed`, `aria-label`,
  side padding honors safe-area insets. Directions / open-landmark actions are untouched.
- State lives in `src/lib/usePickVotes.js`: the SAVED verdict is what shows as selected; status is idle / saving / pending / error.
- Not for me removes the card. On the Map sheet the next pick in the same set moves up; its rank is its position in the set (not
  the slot), and it is logged as shown (`recommendation_log`) when it appears. In chat all stops of a reply are already on
  screen, so there is no next pick to bring in; the card is removed. I'd go and Not sure keep the card, selected; tap another
  button to change the answer (Item 4 handles a two-level change).
- Save first (`setPickFeedback`): Firestore `pick_feedback` is written before the screen, `lh-pick-feedback:{uid}` or the
  profile learning (Item 3) change. A failed write is retried `PICK_VOTE_SAVE_ATTEMPTS` (3) times with doubling backoff from
  `PICK_VOTE_RETRY_BASE_MS` (600 ms, then 1200 ms), then the card shows "Couldn't save your answer. Try again". Nothing is kept on
  the phone.
- Offline (`navigator.onLine === false`): the tap goes to a pending-retry queue (`lh-pick-feedback-pending:{uid}`, at most
  `PICK_VOTE_PENDING_LIMIT` = 50), the card says "Not saved yet. It will send when you're back online." and the button is NOT
  shown as selected. The queue is flushed on the `online` event and when a card mounts; each entry is removed once saved.
- Each vote carries `pickSetId` / `pickSurface` / `pickShownAt` (`pickMarks.js`, only if the place was shown as a pick) and, for a
  chat pick, `requestFor` (`solo` | `group`). `requestFor` needs no rules change: the `pick_feedback` rule does not restrict keys.
- Account deletion: `pick_feedback` docs (with their marks) are removed as before; `clearLocalPickFeedback` now also clears the
  device copy and the pending queue.

## Not done / notes

- The Test tab (admin sandbox, `isTest` picks) shows no vote buttons, so test picks never write real taste data.
- Picks the carousel's `votedIds` filter was the only vote-based filter before; the Map sheet does not hide previously voted places
  on later visits.
- A card removed with Not for me cannot be undone from the screen (no undo control).
