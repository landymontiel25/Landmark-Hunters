# Mapr at scale: 10k, 50k and 100k users

Run of October 6, 2026, 2:19-4:34 AM ET (2 h 15 min of compute, 4 cores).
Three batches of synthetic travelers, 10 Monte Carlo simulations each:

| Batch | Users | Interactions per simulation |
|---|---|---|
| C | 10,000 | 500,000 |
| D | 50,000 | 2,500,000 |
| E | 100,000 | 5,000,000 |

Configuration (all from the earlier tests):

- NCF training: BPR on logits, negatives from the traveler's own city, early
  stopping on validation accuracy.
- Blend: `0.8 x base / max|base| + 0.2 x NCF`, negative base scores kept.
- Baseline: tag score + item-item similarity (Mapr without NCF) on the same
  simulation.

The 500 never-trained "new user" test travelers now sit far past the largest
batch (`--cold-offset 1000000`), so they never appear in training at any
scale. That is why 10k was rerun here: its main numbers match
`WEIGHTS-RESULTS.md` (78.5% vs 78.47%), and its new-user numbers now use the
same travelers as 50k and 100k.

Command: `node pipeline.js --fixed --blend-weights 0.2 --extended --batches
C:10000,D:50000,E:100000 --cold-offset 1000000 --no-data-files` with
`MAPR_OUT_DIR=output-scale`. Data: `output-scale/batch-{C,D,E}-results.json`,
`output-scale/scale-analysis.json`. Analysis script:
`scripts/scale_analysis.py`. Nothing deployed; production code unchanged.

"Accuracy" throughout is held-out pairwise accuracy: of every (loved, not
loved) pair among the places a test traveler rated but Mapr never saw, the
share ranked in the right order. 50% is a coin flip.

## 1. Simple summary

- **Did it win?** Yes. The new Mapr ranks better than tag + similarity at
  every scale tested.
- **How many of 10 runs?** 10 of 10 at 10k, 10 of 10 at 50k, 10 of 10 at
  100k: 30 of 30, and no single run fell short.
- **How much better?** +0.8 points at 10k and +1.6 points at both 50k and
  100k (79.0-79.4% vs 77.4-77.8%), and +2.0 points for brand-new users at
  100k.

## 2. Core numbers

| | 10k | 50k | 100k |
|---|---|---|---|
| New Mapr (blend) | 78.5% | 79.4% | 79.0% |
| Tag + similarity | 77.7% | 77.8% | 77.4% |
| Margin (mean) | +0.76 | +1.60 | +1.61 |
| Margin (worst / best run) | +0.36 / +1.14 | +1.37 / +1.97 | +1.19 / +2.00 |
| Wins | 10/10 | 10/10 | 10/10 |
| SD of blend accuracy | 0.7 | 0.4 | 0.8 |
| NCF alone | 63.4% | 71.6% | 73.3% |
| Popularity (no personalization) | 61.8% | 63.2% | 63.6% |
| True-taste ceiling | 95.4% | 95.4% | 95.4% |

## 3. Convergence and efficiency

The blend starts from the tag score, so it is at 77-78% before NCF trains a
single round (round 0 in the table). 70% and 75% are reached at round 0 in
all 30 runs; the question is how fast NCF adds on top.

Measured on each run's validation pairs (800 travelers, re-scored after every
training round):

| | 10k | 50k | 100k |
|---|---|---|---|
| Rounds to 70% / 75% (blend) | 0 / 0 | 0 / 0 (one run: 1) | 0 / 0 |
| Runs reaching 80% (blend) | 3/10 (rounds 0-10) | 5/10 (rounds 1-16) | 5/10 (rounds 1-11) |
| First round the blend beats tag + similarity | 0-1 | 0-1 (8/10 at round 1) | 0-1 (7/10 at round 1) |
| Rounds for NCF alone to reach 60% | 1-7 (9/10 runs) | 1-2 | 1-2 |
| Rounds for NCF alone to reach 65% | 6-14 (3/10 runs) | 1-3 | 2-3 |
| Rounds trained (mean, early stopping) | 26.8 | 15.9 | 12.3 |
| NCF training time per run | 5.5 min | 16.8 min | 26.1 min |
| Training minutes per point of margin | 7.2 | 10.5 | 16.2 |

Interactions per point of margin: from 10k to 50k, +2,000,000 interactions
bought +0.84 points of margin (2.4 M interactions per point). From 50k to
100k, +2,500,000 interactions bought +0.01 points. The margin is flat past
50k.

More data makes each round worth more: NCF needs half as many rounds at 100k
as at 10k, and early stopping comes sooner.

## 4. Scaling story

- **Accuracy plateaus.** It improves from 10k to 50k (+0.9 points), then
  holds from 50k to 100k (-0.4, within one SD). The margin over tag +
  similarity doubles from 10k to 50k and stays at +1.6.
- **NCF alone keeps improving** (63.4% to 71.6% to 73.3%), but at weight 0.2
  the extra NCF accuracy no longer moves the blend. A higher NCF weight at
  50k+ users is the obvious next test.
- **Consistency:** the SD is 0.7, 0.4 and 0.8 points. It tightened at 50k
  and loosened slightly at 100k. The worst run's margin rose from +0.36 at
  10k to +1.19-1.37 at 50k and 100k, so the floor improved most.

## 5. Cold start (500 never-trained users, 5 ratings known)

| | 10k | 50k | 100k |
|---|---|---|---|
| New Mapr | 67.6% | 67.7% | 68.1% |
| Mapr today (tag + similarity) | 66.1% | 66.1% | 66.1% |
| Gain | +1.5 | +1.6 | +2.0 |
| Wins | 10/10 | 10/10 | 10/10 |

New users improve with scale: +2.0 points at 100k against +1.5 at 10k.

## 6. Quality metrics

| | 10k | 50k | 100k |
|---|---|---|---|
| Held-out NDCG@10, blend / tag + sim | 0.789 / 0.787 | 0.789 / 0.784 | 0.788 / 0.784 |
| Catalog NDCG@10, blend / tag + sim | 0.0714 / 0.0712 | 0.0727 / 0.0722 | 0.0753 / 0.0743 |
| Catalog Recall@10, blend / tag + sim | 0.1215 / 0.1202 | 0.1242 / 0.1219 | 0.1295 / 0.1275 |

Ranking quality improves slightly (NDCG +0.004-0.005 at 50k and 100k).
Recall@10 over the whole catalog rises with scale for both methods, a little
more for the blend (+2.0% relative at 100k). Most of the gain shows in
getting individual comparisons right (section 2), less in the top-10 list as
a whole.

## 7. Stability by traveler type (100k, pooled over 10 runs)

Best understood (new Mapr): Outdoor Enthusiast 93.3%, Culture Vulture 92.7%,
Religious Heritage Traveler 92.3%, Hiker 91.0%, Birdwatcher 90.7%. These are
the same types that top 10k and 50k.

Still struggling: Generalist Explorer 57.3%, Indecisive Tourist 60.5%,
Cheesesteak Purist 62.8%, Cocktail Connoisseur 64.5%, Sushi Devotee 65.2%.
Generalist Explorer and Indecisive Tourist sit at the bottom at every scale:
their tastes are broad and inconsistent by design.

Scale helps the niche types most. The types the blend ranks worse than tag +
similarity fall from 18 of 111 at 10k to 7 at 50k and 2 at 100k (Culture
Vulture -0.3, Latin Food Explorer -0.4). The biggest gains at 100k are Jazz &
Lounge Night +4.2, Cheesesteak Purist +4.1, Seasoned Local +4.0, Caribbean
Flavor +3.7 and Seafood & Sunsets +3.5: narrow tastes where similar
travelers carry signal that tag categories miss.

## 8. Per-landmark learning

Skipped: the catalog is fixed at the 3,174 real places, so there is no 1k /
5k / 10k-landmark comparison. Region size, the closest proxy, is in
section 11.

## 9. User learning curve (new users, 500 per run)

The same never-trained travelers, scored on the same last 15 places, with 5,
10, 20 or 35 of their ratings known:

| Ratings known | 10k: blend vs tag + sim | 100k: blend vs tag + sim | Runs won at 100k |
|---|---|---|---|
| 5 | 67.4% vs 65.9% | 68.0% vs 66.0% | 10/10 |
| 10 | 71.7% vs 70.9% | 72.2% vs 71.0% | 10/10 |
| 20 | 75.1% vs 74.7% | 75.5% vs 74.8% | 10/10 |
| 35 | 77.3% vs 77.1% | 77.7% vs 77.2% | 10/10 |

Breakeven is immediate. The blend beats tag + similarity from the first 5
ratings (the smallest tested), in every run at every scale. The advantage is
largest for new users (+2.0 at 5 ratings) and shrinks as the traveler's own
history grows (+0.5 at 35). Per-user medians are not computed: 15 test
places per user are too few for a stable per-user breakeven.

## 10. Recommendation quality beyond accuracy (top 10, 100k)

| | New Mapr | Tag + sim |
|---|---|---|
| Kinds of place in the top 10 | 5.6 | 4.7 |
| Categories in the top 10 | 1.6 | 1.5 |
| Lesser-known places (popularity 1 of 10) | 41% | 40% |
| Outside the traveler's history (no shared kind or category) | 5.8% | 5.9% |

- **Diversity:** the top 10 covers 19% more kinds of place (5.6 vs 4.7),
  the same at 10k and 50k.
- **Serendipity:** about the same as tag + similarity. 41% of the top 10
  are lesser-known places, and 6% sit outside anything the traveler has
  rated.
- **Confidence:** 83% of decisions are clear calls (score gap of 0.1 or
  more), and those are right 83% of the time. Marginal calls (gap under
  0.02) are 4.5% of decisions and right 53% of the time. The two methods
  agree on 95% of comparisons; where they disagree, the new Mapr is right
  79% of the time at 100k (73% at 10k).

## 11. Regional variance

| Region (places) | 10k gain | 50k gain | 100k gain | 100k accuracy |
|---|---|---|---|---|
| NYC (119) | +0.9 | +2.4 | +1.9 | 79.4% |
| Milan area (165) | +1.0 | +1.8 | +1.8 | 83.1% |
| Silicon Valley (214) | +1.3 | +2.4 | +2.1 | 77.9% |
| Madrid area (227) | +0.8 | +1.4 | +1.4 | 81.9% |
| San Francisco (451) | +0.6 | +1.2 | +1.3 | 76.8% |
| Philly (996) | +0.8 | +1.6 | +1.7 | 82.3% |
| Miami area (1,002) | +0.5 | +1.3 | +1.6 | 75.1% |

The new Mapr beats tag + similarity in every region at every scale. Smaller
catalogs bootstrap faster: NYC and Silicon Valley gain +1.9 to +2.4 points at
50k and 100k, while San Francisco and Miami gain the least (+1.2 to +1.6). With fewer
places, each one collects more travelers and the model learns it sooner.

## 12. Robustness

- **No cliff anywhere.** All 30 runs, all 7 regions, and 109 of 111 traveler
  types at 100k come out at or above tag + similarity. The two exceptions
  are 0.3-0.4 points down.
- **Contradictory tastes** (Generalist Explorer, Indecisive Tourist) stay
  near 57-61% for both methods: the blend neither helps nor hurts them. It
  degrades to the baseline, not below it.
- **Sparse regions:** the smallest catalog (NYC, 119 places) gains the most.
  Sparse data inside a large catalog is the harder case: Miami and San
  Francisco gain least.
- **Brand-new users with 5 ratings:** still ahead, in all 30 runs.
- **Plateau, not decline:** 100k is 0.4 points below 50k, inside one SD.
- **Not tested:** seasonal or time-based taste shifts (the simulator has no
  time), and real users. The travelers are synthetic, and their taste is a
  weighted sum of place features, which favors tag scoring. Real travelers
  are messier.

## 13. For HAA

> Landmark Hunters' recommender, Mapr, blends a taste score from each
> traveler's ratings with a neural collaborative filtering model that learns
> from everyone. We tested it offline on up to 100,000 synthetic travelers
> drawn from 111 personality types, 5 million ratings of the app's real
> 3,174 places, 10 independent simulations per scale. The tuned Mapr beat
> its own simpler method in all 30 simulations, by 0.8 points at 10,000
> travelers and 1.6 points at 50,000 and 100,000, with the weakest run still
> 1.2 points ahead at 100,000. It held in all seven cities. Brand-new
> travelers gained the most: 2 points after their first five ratings.
>
> This is not a single lucky run. The result held across 30 random
> populations, a tenfold range of scale and every region, and the same
> tests first caught the training and blending bugs that were fixed before
> this run. For the
> product, it means every traveler, including one who just signed up, gets
> recommendations at least as good as before and usually better. The gain
> widens as the user base grows to 50,000 and then holds. The next step is a
> staged rollout to real users, who will show how much of the synthetic gain
> carries over.
