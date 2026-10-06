# Open work

Unfinished work and the decisions behind it, newest first. Remove an item in
the PR that finishes it.

## Mapr synthetic training: findings to act on (needs an owner decision)

`mapr-synthetic-trainer/` trains the production Mapr code offline on 10,000
synthetic travelers (results: `mapr-synthetic-trainer/RESULTS.md`). Nothing
was deployed and no production code changed. What it found:

- The full blend (`0.4 x base + 0.6 x NCF`) ranks below tag score +
  similarity alone at every scale tested (75.2% vs 77.7% at 10,000 users).
  Options: give NCF less weight until it beats the base on real holdout
  data, or gate it on that comparison instead of on user count
  (`NCF.autoEnableAboveUsers`).
- Production NCF applies BPR to sigmoid outputs; the sigmoid saturates and
  the gradients vanish. The tiny values also slow the nightly job's
  training (subnormal floats) inside its 30 s budget. Early stopping
  watches validation loss, which picks near-untrained models when the loss
  is switched to plain BPR on logits. Tested over 30 simulations
  (`mapr-synthetic-trainer/FIX-RESULTS.md`): BPR on logits + same-city
  negatives + early stopping on accuracy beat production NCF in 25 of 30
  but beat tag + similarity in only 4 of 30, so it is not deployed. All 4
  wins kept a barely trained NCF: at 0.6 weight a trained NCF overrides
  the tag score. Re-scored at weights 0.3/0.2/0.1
  (`mapr-synthetic-trainer/WEIGHTS-RESULTS.md`): weight alone wins at most
  9 of 30, because the blend also clips negative base scores to 0. With the
  sign kept, `0.8 x base / max|base| + 0.2 x NCF` beat tag + similarity in
  28 of 30 and new users gained 1.5 points. Waiting on the owner's go to
  ship the three NCF fixes plus that blend to every Mapr surface in one PR
  (CLAUDE.md), staged behind a rollout.
- Pre-trained models gave brand-new users no lift over today's cold start,
  so `deploy-to-production.js` has not been run and nothing reads
  `mapr_pretrained_*`. Run it only after a change makes pre-training help.

## Admin dashboard setup (owner, once)

The stats moved out of the app into `admin-dashboard/` (its own Vercel
project). Until the owner does the setup in `admin-dashboard/README.md`
(new Vercel project with Root Directory `admin-dashboard`, its env vars,
`ADMIN_JOBS_SECRET` + `DASHBOARD_URL` on the main app, publish
`firestore.rules`), there is no way to see the stats. Phase 2, not built:
Firebase Auth login instead of the shared password, date ranges, chart
annotations.

## Mapr Phase 1 follow-ups (shipped, waiting on users or the owner)

Phase 1 is live on every Mapr surface (`docs/mapr-phase1.md`). Left open:

- The NCF model ranks nothing until more than 10 users have a check-in or a
  loved rating in 90 days (`NCF.autoEnableAboveUsers`). It switches itself on.
- The spec's outcome targets (match rate 65% to 75%, A/B significance,
  retention) need real traffic. Watch the admin dashboard's Mapr Phase 1 page and the
  daily Slack message. Once there are enough users, lower a rollout below
  100 in `src/lib/maprRank/config.js` to run a real A/B test.
- Not built, needs an owner decision: the optional "preference reset" for
  stagnating users (drops the oldest 30% of ratings, so it deletes data).
- Dwell time is not tracked (the app records arrivals, not departures).

## Photos for imported places (started, not finished)

Share of places with a photo, on main as of 2026-10-05:

| Region | Places | With a photo |
| --- | --- | --- |
| Miami | 847 | 69 |
| Philly | 904 | 118 |
| Villanova | 13 | 0 |
| San Francisco | 336 | 64 |
| Silicon Valley | 118 | 23 |

Photos come from two places (details in `docs/photos.md`):

- Wikimedia Commons photos stored in the packs, found by
  `scripts/find-commons-photos.mjs` and reviewed by hand. A Commons photo
  needs a nearby geotag or the area named, and a reviewer rejects any photo
  that doesn't show the place.
- Google photos loaded live from `api/place-photo.js`: a 250 m radius and a
  strict name match, or no photo at all. Imported places (`source: 'osm'`)
  skip the Google lookup in dense lists (`LandmarkThumb` passes
  `lookup: false`) and get it only on the landmark page and nearby picks, to
  keep Google costs down.

Next steps to decide with the owner: run the Commons finder again for SF and
Silicon Valley, and choose whether imported places should get the Google
lookup in more places in the app, with a per-day cap.

## Thin categories in SF and Silicon Valley

SF has 3 history/culture places and Silicon Valley has 0. The SF import kept
only places with sourced facts and dropped neighborhood parks and branch
libraries in hand review. A second research pass on history spots
(landmarks, historic districts, museums of local history) would fill this.
Follow `docs/sf-import/README.md`.

## Size of SF and Silicon Valley

SF has 336 places and Silicon Valley 118, against Philly's 904. The research-
first method keeps only places it can source. More neighborhood and town
batches (`scripts/osm-import/research/sf/RESEARCH-PROMPT.md`) would grow both.
