# Mapr synthetic user trainer

Offline simulation that trains and tests Mapr Phase 1 on 10,000 synthetic
travelers. It runs on your machine, reads nothing from production and writes
nothing to it. The optional Firestore writes go only to the local emulator.

Results of the full run: [`RESULTS.md`](RESULTS.md). NCF fix test (30 simulations): [`FIX-RESULTS.md`](FIX-RESULTS.md). Blend weights: [`WEIGHTS-RESULTS.md`](WEIGHTS-RESULTS.md). Screenshots: [`screenshots/`](screenshots/).

## Run it

```bash
cd mapr-synthetic-trainer
npm install
npm start                 # dashboard on http://localhost:3000 + full run (about 1 hour on 4 cores)
npm run quick             # same pipeline, small: 2 sims, 300/600/1,000 users, 4 epochs (under a minute)
npm run train             # full run, console only
node server.js --view     # dashboard only, following a run started with npm run train
node pipeline.js --fixed   # same run with the three NCF fixes (use MAPR_OUT_DIR=output-fix)
node pipeline.js --fixed --blend-weights 0.6,0.3,0.2,0.1   # re-score the blend at several NCF weights
node compare-runs.js      # per-simulation comparison of output/ vs output-fix/
node experiments.js       # diagnostics: loss and negative-sampling variants (output/experiments.json)
npm test                  # unit tests (from the repo root's vitest)
```

With the Firestore Emulator (optional, needs Java 11+):

```bash
bash emulator-setup.sh                       # terminal 1, leave open
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
npm start                                    # terminal 2
```

The run then also writes `mapr_synthetic_train` (one doc per interaction)
and `mapr_batch_{a,b,c}_results` to the emulator. `lib/emulator.js` refuses
any `FIRESTORE_EMULATOR_HOST` that is not on this machine.

## What it does

1. **Users.** 111 archetypes (`synthetic-users.js`): 35 food, 12 nightlife,
   14 culture, 10 outdoors, 5 local life, 18 travel styles, 17 two-interest
   mixes. Each is a weight per place feature: category (`c:food`), kind
   from the production `placeKinds` (`k:italian`, `k:trails`), price
   (`cost:$$$`) and fame (`pop:famous`, `pop:local`). Each user scales their
   archetype's weights by their own random factor and adds one or two
   personal likes, sometimes a personal dislike.
2. **Places.** The real catalog: 3,174 places in 7 areas (Miami, Philly,
   San Francisco, Silicon Valley, NYC, Madrid, Milan), from `src/data` plus
   the `public/places` packs.
3. **Interactions** (`interaction-simulator.js`). Each user meets 50 random
   places in their area and reacts with the spec's `simulateInteraction`:
   match over 0.7 rates 4-5 (sometimes loves it), 0.4-0.7 rates 3-4, 0.2-0.4
   rates 2-3, under 0.2 skips. 10,000 users x 50 = 500,000 interactions.
4. **Training**, with the production code from `src/lib/maprRank/`:
   - NCF (`ncf-model.js`): the production network, initialisation, BPR loss,
     Adam, batch 32, 50 epochs, patience 5. It is a faster loop around the
     same math; `test/ncf-model.test.js` checks it ends with bit-identical
     weights to production `trainModel`.
   - Item-item similarity: production `computeRegionSimilarity`
     (0.6 Jaccard + 0.4 cosine, top 20).
   - Tag scores: production `applyRating` / `applyVote` and `kindBoost`.
5. **Evaluation** (`batch-trainer.js`, `evaluator.js`). Each user's
   interactions split 70% train, 10% validation (early stopping), 20% test.
   Up to 2,000 users per batch are scored. Seven rankers on the same users:
   random, popularity, tag score, tag + similarity, NCF alone, the full Mapr
   blend (`0.4 x base + 0.6 x NCF`, as in `rank.js`), and the true taste with
   no noise (the ceiling).
   - **Accuracy** = held-out pairwise accuracy: of every (liked, not liked)
     pair among the places a test user actually met in the test split, the
     share the ranker orders right. 50% is a coin flip. "Liked" = rated 4-5
     or loved, the rule production NCF trains on.
   - Held-out NDCG@10 ranks the user's 10 test places by graded gain.
   - Catalog NDCG@10, MAP@10, Recall@10 rank every unseen place in the area.
     Most of those carry no label, so even the ceiling scores low there.
6. **Cold start.** 500 extra users per simulation are never trained on.
   Mapr sees their first 5 interactions and is scored on the other 45. "Mapr
   today" is tag + similarity (production NCF skips users it has no
   embedding for); "with pre-trained NCF" folds the new user into the
   trained model.
7. **Batches and Monte Carlo** (`monte-carlo.js`). Batches A, B and C train
   on the first 1,000, 5,000 and 10,000 users. Each batch runs 10 times on a
   freshly simulated population: new seed, archetype shares +-5%,
   preference spread +-5%, rating noise +-10%.
8. **Outputs** in `output/`: `learning-curve.csv`, `final-report.csv`,
   `summary.json`, `batch-{A,B,C}-results.json`, and (not committed,
   rebuilt by any run) the synthetic data and `trained-*.json` models.

## Where this differs from the spec, and why

- **Expected numbers.** The spec expected 60% -> 85% -> 91%. Nothing here is
  tuned toward those numbers; the run reports what the production code
  learned. See `RESULTS.md`.
- **No 1-star ratings.** The spec's simulator gives at least 2 stars to
  anything it does not skip. Kept as written.
- **Places.** Real places from 7 areas, not Rome (the app has no Rome).
- **Test users.** Batch A has 1,000 users, so its test set is all 1,000
  (the spec asked for 2,000).
- **"Accuracy: does predicted rating match actual rating?"** BPR learns an
  order, not a star rating, so accuracy is pairwise order agreement.
- **ml5.js** is not used: the production NCF is plain JS already.
- **Flush-to-zero** in the Adam update (`ncf-model.js`): production's BPR
  saturates the output sigmoid, and the vanishing values then sit in the
  subnormal float range, which made epochs 4-5x slower. Values under 1e-250
  become 0; losses match production to 4 decimals.
- **Deployment.** `deploy-to-production.js` is a dry run unless you pass
  `--confirm` with a service account. Nothing has been deployed. It never
  uploads synthetic user embeddings, and nothing in the app reads
  `mapr_pretrained_*` yet (see `docs/open-work.md`).
