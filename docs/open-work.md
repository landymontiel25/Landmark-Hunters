# Open work

Unfinished work and the decisions behind it, newest first. Remove an item in
the PR that finishes it.

## Mapr v2 rollout (shipped at 20%, waiting on users)

The three NCF fixes and the signed `0.8 / 0.2` blend ship behind
`FEATURES.maprV2` at 20% on every Mapr surface (`docs/mapr-phase1.md`,
"Mapr v2 rollout"). Evidence so far is synthetic only
(`mapr-synthetic-trainer/SCALE-RESULTS.md`, `VALIDATION-RESULTS.md`: 60 of
60 runs won over tag + similarity). Left open:

- Neither model ranks until more than 10 people have a check-in or loved
  rating in 90 days (`NCF.autoEnableAboveUsers`). Until then the A/B arms
  rank the same way; the dashboard's "v2 model ranked" share stays at 0%.
- Once NCF is on: watch the "Mapr v2 rollout" card. Grow the rollout
  (`FEATURES.maprV2.rollout`) when the A/B says promote; when v2 reaches
  100%, make `NCF_V2` the only model and remove v1 training.
- Pre-trained models gave brand-new users no lift over today's cold start,
  so `mapr-synthetic-trainer/deploy-to-production.js` has not been run and
  nothing reads `mapr_pretrained_*`.

## Admin dashboard setup (owner, once)

The dashboard reads Firestore on the server with `FIRESTORE_ADMIN_KEY` (a
live service-account key; no browser key, no Firebase sign-in). If it shows
"Can't connect to Firestore", the banner names the cause. The old key that
was committed to the repo is revoked; rotate any key that was ever in git.


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
