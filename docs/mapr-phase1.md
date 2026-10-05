# Mapr Phase 1: distance decay, item-item CF, NCF, exploration

All four weeks of the Phase 1 spec, built on this app's stack: ranking on the
phone (`src/lib/nearbyPicks.js` → `src/lib/maprRank/`), batch jobs in a Vercel
cron with the Admin SDK, storage in Firestore. Everything sits behind feature
flags in `src/lib/maprRank/config.js`, the one place that holds every
hyperparameter and threshold.

Scope: the Map tab's "Picked for you right now" sheet (the `map-sheet`
surface). Mapr chat, Travel Picks (`api/mapr-picks.js`) and the trip planner
rank the way they did before.

## Pipeline

```
rankNearbyCandidates (nearbyPicks.js)        tag-score queues, as before
  └─ scorePicks (maprRank/rank.js)
       Week 1  after_decay = tag_score / (1 + km / 1.5)
       Week 2  base = after_decay * (1 + item_item_boost)     boost ≤ 0.2
       Week 3  final = 0.4 * base / max(base) + 0.6 * ncf     NCF treatment only
  └─ planExploration (rank.js)                                 exploration treatment only
       epsilon from user state, 20-place exploration set
composePicks (nearbyPicks.js)
       treatment: each slot explores with probability epsilon
       control:   today's composition (usual + one "Something new")
```

Each step has a fallback: no model, a broken model, a user the model has never
seen, or inference over its 10 ms budget drops back to the step before (the
last case first serves cached NCF scores from the previous request). The set
always fills.

## Files

| What | Where |
|---|---|
| Config, flags, rollouts, thresholds | `src/lib/maprRank/config.js` |
| Distance decay + haversine | `src/lib/maprRank/distanceDecay.js` |
| Rollout / A/B bucketing, seeded RNG | `src/lib/maprRank/experiments.js` |
| Similarity matrix + boost | `src/lib/maprRank/similarity.js` |
| NCF model (train, BPR, Adam, serve) | `src/lib/maprRank/ncf.js` |
| Epsilon, novelty, stagnation | `src/lib/maprRank/exploration.js` |
| Scoring pipeline | `src/lib/maprRank/rank.js` |
| Model loading on the phone (12 h cache) | `src/lib/maprRank/modelStore.js` |
| Times-shown history on the phone | `src/lib/maprRank/seenHistory.js` |
| Daily metrics, A/B stats, alerts, CSV, Slack text | `src/lib/maprRank/metrics.js` |
| Nightly + weekly batch work | `api/_lib/maprNightly.js` |
| Cron route (00:23 UTC daily) | `api/mapr-nightly.js` |
| Admin dashboard panel | `src/components/MaprPhase1Panel.jsx` (Admin stats page) |
| "Shake things up?" card | `src/components/nearbyPicks/ShakeUpCard.jsx` |

## Firestore

| Collection | Written by | Read by |
|---|---|---|
| `mapr_models/ncf`, `ncf_prev` | nightly job | signed-in app (weights + landmark embeddings) |
| `mapr_models/signals` | nightly job | signed-in app (check-ins this week per place) |
| `mapr_models/status` | nightly job | admin endpoint |
| `mapr_similarity/{region}` | nightly job | signed-in app |
| `mapr_user_models/{uid}` | nightly job | owner only (embedding per model version, stagnation flag); owner may delete |
| `mapr_metrics/{date}` | nightly job | admin endpoint only |

`recommendation_log` rows from the sheet now carry the telemetry fields listed
in `src/lib/recommendationLog.js` (`telemetry: true` marks them).
`user_action` (viewed / visited / rated / skipped), rating and repeat come from
joining the row to `pick_feedback`, `reviews` and `checkins` within 7 days.

## Setup checklist

1. Deploy the Firestore rules (new blocks for the four collections above).
2. Vercel env: `CRON_SECRET` and `FIREBASE_SERVICE_ACCOUNT` (both already used
   by the study summary). Add `SLACK_WEBHOOK_URL` (a Slack incoming webhook)
   for the daily message; without it the job runs and skips Slack.
3. After the deploy, press **Run now** in Admin stats → Mapr Phase 1, so the
   models exist before the first Monday retrain.

## Rollout and rollback

- `FEATURES` in `config.js`: `enabled` turns a component off for everyone,
  `rollout` (0-100) sets the share of users. Users are bucketed by a salted
  FNV-1a hash of the uid, so the same user always gets the same variant and
  growing a rollout keeps everyone already in it.
- Defaults: distance decay 100%, item similarity 100%, NCF 20% (A/B), exploration 20% (A/B).
- NCF promotion: a new weekly model is not promoted if its holdout accuracy is
  more than 5% below the live one. If the live model has drifted more than 10%
  on this week's data, the job rolls back to `ncf_prev`. User docs keep the
  embeddings of the last two versions, so a rollback still finds them.
- To revert a component, set `enabled: false` and deploy. No data migration.

## Where this differs from the spec, and why

- **Decay multipliers.** The spec's table (0.5 km → 3.0x, 1.5 km → 1.0x) does
  not match its formula `1 / (1 + d / 1.5)` (0.5 km → 0.75x, 1.5 km → 0.5x).
  The code uses the formula. Ranking only depends on ratios, so a rescaled
  table would not change which place wins. Negative scores divide instead of
  multiply, so nearer stays better.
- **Redis, S3** → Firestore docs plus a 12-hour cache on the phone and an
  in-memory cache. No Redis exists in this stack, and ranking runs on the
  phone, so the phone needs the data anyway.
- **PyTorch** → the same network in plain JS (32-d embeddings, 64→64→32→1,
  ReLU, dropout 0.2, Adam 0.001, batch 32, 50 epochs, patience 5, 1:5
  negatives, temporal 70/15/15 split). A Vercel Node function cannot ship
  PyTorch. A numerical gradient check in the tests proves the backprop.
- **Loss.** The spec lists BCE in the hyperparameters and BPR in the loss
  section; BPR is used.
- **Refit.** After early stopping picks the epoch count on the split, the
  served model is refit on the whole 90-day window for that many epochs, so
  users and places from the last 27 days get embeddings. Holdout accuracy is
  still reported from the split run.
- **Blend scale.** Tag scores are points, NCF is 0-1, so the base is divided
  by the best base in the request before `0.4 * base + 0.6 * ncf`. A place
  with no embedding gets the request's average NCF score.
- **`user_id % 100`** → hash of the uid string (uids are strings).
- **Collab boost** is capped at +20% in total (the spec's "max boost of +20%"
  and Week 3's `collaborative_boost (0-1.2)`).
- **Exploration.** Per slot instead of per request: each of the 4 slots
  explores with probability epsilon. Per request would show 4 unknown places
  one time in five. Per slot hits the same 20% share with less swing.
  Stagnating users go to 50%. The control arm is today's composition, which
  already holds one "Something new" in four.
- **Match rate.** "Match rate" stays the existing reaction-based rate
  (`matchRate.js`), which is where the 65% baseline comes from. The spec's
  literal formula, visited and rated 4+ over all shown, is reported next to
  it as "visit-and-love rate".
- **Skip rate** = shown picks with no tap, visit or rating within 7 days.
- **Dwell time** is reported as null: the app records arrivals, not departures.
- **Stagnation intervention.** Built: epsilon 50%, the "Shake things up?"
  card, trending places in the exploration set. Not built: the optional
  preference reset (drop the oldest 30% of ratings), since it deletes user
  data and needs a product decision first.
- **Training budget.** The weekly job has 30 s of training inside Vercel's
  60 s limit. It stops at the best epoch so far when time runs out, and the
  status doc records `stoppedBy: 'time-budget'`.

## What needs real traffic

The code, tests and dashboards are in place. The numbers themselves (match
rate moving from 65% toward 75%, A/B significance after 1-2 weeks, retention
lift) need users and calendar time. The admin panel and the Slack message show
them daily, and each A/B row carries its decision (`collecting`, `promote`,
`revert`, `neutral-investigate`) once it has run 7 days.

## Measured in tests

- Ranking with every step on, 100 requests over the real Milan catalog:
  p50 2 ms, p99 5 ms (target under 100 ms).
- NCF scoring of 100 landmarks: under 10 ms.
- Similarity for 500 landmarks with 20 neighbors each: about 0.1 s (target under 10 min).
- NCF training on 1,000 examples: about 6 s (target under 5 min).
- Line coverage of the new code: 97%.
