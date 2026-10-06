# Independent validation on fresh seeds

Run of October 6, 2026, 9:44 AM-12:04 PM ET (2 h 20 min of compute).

`SCALE-RESULTS.md` tested the new Mapr on seeds 1001-1010, the same seeds used
to choose the 0.2 weight and the signed blend. This run repeats it on seeds
**7001-7010**, chosen before any result was seen:

- New travelers, ratings and places met.
- The per-simulation variations (preference spread, rating noise) come from
  a new master seed (7000 instead of 2026).
- Nothing else changed: BPR on logits, same-city negatives, early stopping
  on validation accuracy, blend `0.8 x base / max|base| + 0.2 x NCF` with
  negatives kept, 10 simulations per batch, 500 never-trained users per
  simulation at `--cold-offset 1000000`, same metrics.

The only code change is the `--seed-base` flag (`monte-carlo.js`); the
default seeds reproduce the earlier runs unchanged.

Command: `node pipeline.js --fixed --blend-weights 0.2 --extended --seed-base
7000 --batches C:10000,D:50000,E:100000 --cold-offset 1000000
--no-data-files`, with `MAPR_OUT_DIR=output-validation`.

Data:
- `output-validation/runs.csv`: one row per simulation, all 30.
- `output-validation/batch-{C,D,E}-results.json`: full results.
- `output-validation/final-report.csv`: aggregates.
- `output-validation/scale-analysis.json`: extended metrics
  (`python3 scripts/scale_analysis.py output-validation C,D,E`).

Nothing deployed; production code unchanged.

Accuracy = held-out pairwise accuracy (loved vs not-loved pairs among places
a test traveler rated and Mapr never saw; 50% = coin flip).

## 1. Simple summary

- **Did it win?** Yes, at all three scales, on travelers it was never tuned
  on.
- **How many of 10 runs?** 10 of 10 at each scale: 30 of 30.
- **How much better than tag + similarity?** +0.7 points at 10k, +1.3 at 50k
  and +1.7 at 100k, and +1.5 to +2.1 points for brand-new users.

## 2. Core numbers, compared with the tuning run

| | 10k | 50k | 100k |
|---|---|---|---|
| New Mapr | 78.18% | 79.14% | 79.55% |
| Tag + similarity | 77.44% | 77.81% | 77.83% |
| **Margin (fresh seeds)** | **+0.73** | **+1.33** | **+1.72** |
| Margin (tuning seeds, `SCALE-RESULTS.md`) | +0.76 | +1.60 | +1.61 |
| Margin worst / best run | +0.28 / +1.17 | +1.04 / +1.72 | +1.42 / +1.99 |
| Margin SD | 0.25 | 0.20 | 0.16 |
| Blend SD | 0.75 | 0.86 | 0.71 |
| Wins | 10/10 | 10/10 | 10/10 |
| NCF alone | 62.2% | 70.8% | 73.6% |
| Popularity | 61.2% | 63.1% | 63.1% |

The margins on fresh seeds match the tuning run within about 0.3 points at
every scale: 0.03 lower at 10k, 0.27 lower at 50k and 0.11 higher at 100k.
Here the gain keeps growing from 50k to 100k, where the tuning run flattened.

## 3. Raw data: all 30 runs

From `output-validation/runs.csv`. Margin and cold margin are in points.

| Batch | Sim | Seed | Blend | Tag + sim | Margin | Cold blend | Cold tag + sim | Cold margin | Rounds (best) |
|---|---|---|---|---|---|---|---|---|---|
| C 10k | 1 | 7001 | 0.773346 | 0.770572 | +0.277 | 0.672950 | 0.660129 | +1.282 | 45 (40) |
| C 10k | 2 | 7002 | 0.782423 | 0.775243 | +0.718 | 0.681061 | 0.669126 | +1.193 | 38 (33) |
| C 10k | 3 | 7003 | 0.782759 | 0.774074 | +0.869 | 0.666724 | 0.640413 | +2.631 | 6 (1) |
| C 10k | 4 | 7004 | 0.789143 | 0.781509 | +0.763 | 0.655677 | 0.642753 | +1.292 | 28 (23) |
| C 10k | 5 | 7005 | 0.768562 | 0.760916 | +0.765 | 0.707396 | 0.677765 | +2.963 | 6 (1) |
| C 10k | 6 | 7006 | 0.786291 | 0.778282 | +0.801 | 0.674399 | 0.663776 | +1.062 | 33 (28) |
| C 10k | 7 | 7007 | 0.780490 | 0.773054 | +0.744 | 0.679146 | 0.654819 | +2.433 | 6 (1) |
| C 10k | 8 | 7008 | 0.779393 | 0.775581 | +0.381 | 0.671883 | 0.661122 | +1.076 | 24 (19) |
| C 10k | 9 | 7009 | 0.795133 | 0.786783 | +0.835 | 0.693250 | 0.668864 | +2.439 | 6 (1) |
| C 10k | 10 | 7010 | 0.779961 | 0.768232 | +1.173 | 0.693729 | 0.665418 | +2.831 | 6 (1) |
| D 50k | 1 | 7001 | 0.790060 | 0.776101 | +1.396 | 0.677547 | 0.660191 | +1.736 | 15 (10) |
| D 50k | 2 | 7002 | 0.801358 | 0.789534 | +1.182 | 0.688174 | 0.669944 | +1.823 | 12 (7) |
| D 50k | 3 | 7003 | 0.783055 | 0.771495 | +1.156 | 0.654089 | 0.640297 | +1.379 | 11 (6) |
| D 50k | 4 | 7004 | 0.786615 | 0.771771 | +1.484 | 0.657025 | 0.642230 | +1.480 | 15 (10) |
| D 50k | 5 | 7005 | 0.796607 | 0.779422 | +1.719 | 0.695310 | 0.677425 | +1.788 | 12 (7) |
| D 50k | 6 | 7006 | 0.795669 | 0.781779 | +1.389 | 0.676325 | 0.663019 | +1.331 | 16 (11) |
| D 50k | 7 | 7007 | 0.782869 | 0.771300 | +1.157 | 0.672193 | 0.654823 | +1.737 | 13 (8) |
| D 50k | 8 | 7008 | 0.777937 | 0.764169 | +1.377 | 0.671311 | 0.661547 | +0.976 | 25 (20) |
| D 50k | 9 | 7009 | 0.795581 | 0.785173 | +1.041 | 0.682799 | 0.669238 | +1.356 | 13 (8) |
| D 50k | 10 | 7010 | 0.803778 | 0.790321 | +1.346 | 0.682591 | 0.665964 | +1.663 | 14 (9) |
| E 100k | 1 | 7001 | 0.787443 | 0.770353 | +1.709 | 0.685198 | 0.660242 | +2.496 | 10 (5) |
| E 100k | 2 | 7002 | 0.799181 | 0.781756 | +1.742 | 0.691409 | 0.669793 | +2.162 | 11 (6) |
| E 100k | 3 | 7003 | 0.794067 | 0.777862 | +1.620 | 0.660616 | 0.640587 | +2.003 | 10 (5) |
| E 100k | 4 | 7004 | 0.789728 | 0.769859 | +1.987 | 0.659146 | 0.642119 | +1.703 | 12 (7) |
| E 100k | 5 | 7005 | 0.804856 | 0.786396 | +1.846 | 0.698831 | 0.677701 | +2.113 | 13 (8) |
| E 100k | 6 | 7006 | 0.792693 | 0.776793 | +1.590 | 0.679567 | 0.663276 | +1.629 | 13 (8) |
| E 100k | 7 | 7007 | 0.794504 | 0.778419 | +1.609 | 0.673928 | 0.654970 | +1.896 | 10 (5) |
| E 100k | 8 | 7008 | 0.797464 | 0.778943 | +1.852 | 0.681647 | 0.661325 | +2.032 | 12 (7) |
| E 100k | 9 | 7009 | 0.808346 | 0.790421 | +1.793 | 0.694188 | 0.669132 | +2.506 | 10 (5) |
| E 100k | 10 | 7010 | 0.786567 | 0.772413 | +1.415 | 0.686618 | 0.666625 | +1.999 | 11 (6) |

Lowest-margin run at each scale: C1 (+0.277), D9 (+1.041), E10 (+1.415).

## 4. Brand-new users (500 never-trained per run, 5 ratings known)

| | 10k | 50k | 100k |
|---|---|---|---|
| New Mapr | 68.0% | 67.6% | 68.1% |
| Mapr today (tag + similarity) | 66.0% | 66.0% | 66.1% |
| Gain (mean, worst run) | +1.92 (+1.06) | +1.53 (+0.98) | +2.05 (+1.63) |
| Wins | 10/10 | 10/10 | 10/10 |

With more known ratings, new users at 100k score:

| Ratings known | New Mapr | Tag + sim | Runs won |
|---|---|---|---|
| 5 | 68.2% | 66.1% | 10/10 |
| 10 | 72.2% | 71.0% | 10/10 |
| 20 | 75.7% | 75.0% | 10/10 |
| 35 | 77.8% | 77.2% | 10/10 |

At 50k with 35 ratings known, it won 9 of 10.

## 5. Quality, diversity, confidence (100k)

| | New Mapr | Tag + sim |
|---|---|---|
| Held-out NDCG@10 | 0.791 | 0.786 |
| Catalog NDCG@10 | 0.0753 | 0.0739 |
| Catalog Recall@10 | 0.1286 | 0.1261 |
| Kinds of place in top 10 | 5.6 | 4.7 |
| Lesser-known places in top 10 | 41.5% | 40.3% |
| Outside the traveler's history | 5.3% | 5.3% |

- The two agree on 95.1% of comparisons. Where they disagree, the new Mapr
  is right 80.9% of the time (74.9% at 10k, 75.0% at 50k).
- Clear calls (score gap of 0.1 or more) are 83% of decisions and right
  83.7% of the time. Marginal calls (gap under 0.02) are 4.3% of decisions
  and right 53.5% of the time.

## 6. Regions and traveler types

Gain over tag + similarity by region:

| Region | 10k | 50k | 100k |
|---|---|---|---|
| Silicon Valley | +0.9 | +2.0 | +2.1 |
| NYC | +1.0 | +1.8 | +1.6 |
| San Francisco | +0.7 | +1.1 | +1.8 |
| Philly | +0.5 | +1.3 | +1.8 |
| Miami area | +0.8 | +1.1 | +1.7 |
| Milan area | +0.9 | +1.5 | +1.4 |
| Madrid area | +0.6 | +1.1 | +1.4 |

Every region gains at every scale.

Traveler types where the new Mapr trails tag + similarity: 8 of 111 at 10k
(largest gap -0.4), 3 at 50k (largest -0.6), 2 at 100k (Active Sports Player
-0.4, Spice Seeker -0.1).

- **Best at 100k:** Culture Vulture 93.8%, Outdoor Enthusiast 92.8%,
  Religious Heritage Traveler 92.6%, Birdwatcher 92.1%.
- **Worst at 100k:** Generalist Explorer 57.9%, Indecisive Tourist 62.2%.
  The same two sit at the bottom in the tuning run.

## 7. Training

| | 10k | 50k | 100k |
|---|---|---|---|
| Rounds trained (mean) | 19.8 | 14.6 | 11.2 |
| NCF train time per run | 4.9 min | 17.2 min | 26.5 min |
| Runs that kept the round-1 model | 5/10 | 0/10 | 0/10 |

## What this does and does not show

It shows the tuning run was not a fluke of its seeds. On 10 new populations
the new Mapr won every run at every scale, with margins within about 0.3
points of the tuning run, and new users gained in every run.

What stays the same as before, and so is not independently tested:

- The same 3,174 real places.
- The same 111 archetypes and the same simulator, whose taste model (a
  weighted sum of place features) favors tag scoring.
- The same fixed NCF initialization seed (production's).
- No real users.

The size of the gain on real travelers still has to come from a staged
rollout.
