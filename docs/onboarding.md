# Onboarding and check-in location rules

Numbers and switches live in `src/lib/maprConstants.js`. Logic lives in
`src/lib/checkinRules.js` (GPS rule) and `src/lib/firstCheckIn.js` (first
check-in step).

## The flow

New account: verify email -> **rate 10 real places** -> optional **first
check-in** -> "Always" location (iOS app only) -> done.

The 39 swipe cards (and the "Anything else?" notes) are **optional** and are
not in a new account's path. They can be done any time later:

- A banner on the Map and Mapr tabs ("Finish the swipe cards ..."). Its X
  hides it for the session only (kept in memory with `useSessionState`, nothing
  stored), so it is back the next time the app opens.
- A bell alert (the `onboarding_update` notification, see
  `useOnboardingNotice.js`). It comes back unread every session and stays until
  the cards are finished.

Both read the same state: `onboardingStatus(profile) !== 'complete'`
(`src/lib/onboardingVersion.js`). Finishing every card (`isDeckComplete`) writes
`onboardingVersion`, which clears both. Accounts that already finished the
current `ONBOARDING_VERSION` see nothing. Both open `/onboarding`, which
resumes at the cards.

A new account that leaves the flow without the cards becomes
`onboardingSource: 'signup-skipped'` (status `update`), which is what raises the
banner and the bell alert.

## First check-in (skippable)

`ONBOARDING_FIRST_CHECKIN = true` turns the step on. Shown only to a new
account with **no real check-in** (`needsFirstCheckIn`; rating-only claims do
not count as visits), only **after** the ratings, and only offers places the
user is actually at: inside the place's own radius with a GPS fix no worse than
`CHECKIN_MAX_ACCURACY_METERS`. With nothing nearby, no location or a weak
signal it shows a friendly message and a "Skip for now" button; it is never a
dead end. An unknown check-in count (read failed) is not treated as zero. A
profile saved on the old `checkin` step resumes on this step.

### Why the old required check-in was removed (PR #488)

`docs/feature-audit.md` R2/R3: the required first check-in had no Skip, picked
the **nearest landmark to GPS regardless of distance** (a tester at a desk could
"check in" to a place they were not at, creating a fake visit), and was a dead
end without location. The owner had not separately asked for it to be removed;
this brings it back in a safe form.

## The 30 m check-in rule

`REQUIRE_GPS_CHECKIN` (default **false**) is the one switch. What the audit
found, and what the code actually did before:

- The distance check lived only in `CheckInButton.jsx` (client side), behind a
  hard-coded `REQUIRE_PROXIMITY = false`. So it existed but was switched off.
- Nothing re-checked it when Post was tapped (`CheckInContext.commitCheckIn`),
  and nothing server side can: Firestore rules cannot see the user's position.
- No distance or accuracy was saved on the check-in.

Now `REQUIRE_PROXIMITY` is gone; the button and `commitCheckIn` both use
`checkinBlockReason`.

When ON, a real check-in (not a rating-only claim) needs a GPS fix within the
place's radius (`CHECKIN_RULE_METERS = 30`, or the place's own
`checkInRadiusMeters`) and accuracy no worse than
`CHECKIN_MAX_ACCURACY_METERS = 50`. **Big venues** (parks, malls, beaches,
national parks) set their own larger `checkInRadiusMeters` in
`src/data/landmarks.*.js`; it replaces the 30 m default for that place only.
When OFF, check-in works as it does today.

## What every check-in saves

On every real check-in (rating-only claims are left untagged):

- `distanceMeters`: user's GPS fix to the landmark, whole meters (omitted if it
  could not be computed).
- `gpsAccuracyMeters`: the fix's reported accuracy (omitted if unknown).
- `verification`: `'verified'` only when the rule is ON and the fix passes it;
  `'unverified'` when the rule is OFF or the distance could not be computed.

These are client-reported: the rules only type-check them, so `verified` is not
tamper-proof.

## Firestore rules and account deletion

`firestore.rules` (`checkins`): the three fields are optional and type-checked
on create. The owner-editable set on update gained `distanceMeters` and
`gpsAccuracyMeters` **removal only** (never set or changed), so account deletion
can scrub them. Reads are unchanged; check-ins stay otherwise immutable.
`accountDeletion.js` removes both with `deleteField()`. `verification` holds no
position, so it stays.
