# NCF fix: 30-simulation test

Run of October 6, 2026, 12:39-1:00 AM ET. The same 30 simulated populations
as the baseline run in `RESULTS.md` (same seeds: same travelers, same
ratings), trained with the three NCF fixes:

1. BPR loss on logits instead of sigmoid outputs (no saturation)
2. Negatives from the traveler's own city instead of any city
3. Early stopping on validation ranking accuracy instead of validation loss

`node pipeline.js --fixed` with `MAPR_OUT_DIR=output-fix`. Data:
`output-fix/comparison.csv` (one row per simulation, fixed vs baseline),
`output-fix/batch-{A,B,C}-results.json`, `output-fix/summary.json`.
Production code is unchanged.

## SIMPLE SUMMARY (what to tell other people)

- **Is the fix good or bad?** Good but not enough: it makes Mapr's learning
  better in 25 of 30 tests, but Mapr still recommends slightly worse than its
  simpler tag-and-similarity method.
- **Does the blend beat tag + similarity?** No. It won 4 of 30 tests (0 of 10
  at 1,000 users, 2 of 10 at 5,000, 2 of 10 at 10,000) and trails by 1.4
  points at 10,000 users.
- **Should we deploy?** No. Deploying would make recommendations worse than
  turning the neural part down, which is the next thing to test.

What to say:

- We found a bug in how Mapr learns.
- We tested a fix in 30 simulations.
- The fix works: Mapr's neural part learns better (63% vs 59% on its own).
- It is not enough yet: the full app still ranks better without the neural
  part, so we are not deploying it.
- The tests point at the next fix: the neural part has too much say in the
  final ranking. We test that next.

## Results

Held-out pairwise accuracy (share of loved-vs-not-loved place pairs ordered
right; 50% = coin flip), mean +- sd over 10 simulations per batch. "Old" is
the production NCF on the same simulations.

| Batch | Users | Fixed blend | Old blend | Tag + similarity | Fixed - tag+sim | Beats tag+sim | Beats old blend |
|---|---|---|---|---|---|---|---|
| A | 1,000 | 72.9% +- 1.8 | 70.7% +- 1.6 | 78.1% +- 0.7 | -5.2 | 0/10 | 9/10 |
| B | 5,000 | 76.2% +- 2.0 | 73.8% +- 0.7 | 77.7% +- 0.7 | -1.5 | 2/10 | 9/10 |
| C | 10,000 | 76.4% +- 1.6 | 75.2% +- 0.9 | 77.7% +- 0.8 | -1.4 | 2/10 | 7/10 |
| All | | | | | | **4/30** | **25/30** |

NCF on its own:

| Batch | Fixed NCF | Old NCF |
|---|---|---|
| A | 52.8% | 52.1% |
| B | 59.0% | 56.7% |
| C | 63.4% | 58.9% |

Held-out NDCG@10 (graded by stars, over each user's 10 test places):

| Batch | Fixed blend | Tag + similarity |
|---|---|---|
| A | 0.767 | 0.785 |
| B | 0.776 | 0.785 |
| C | 0.775 | 0.787 |

New users (500 never trained on, 5 ratings known):

| Batch | Fixed blend | Old blend | Mapr today (tag + sim) | Fixed beats today |
|---|---|---|---|---|
| A | 63.2% | 63.3% | 66.4% | 0/10 |
| B | 66.0% | 65.5% | 66.4% | 4/10 |
| C | 65.7% | 66.0% | 66.4% | 2/10 |

Training time per run (NCF): 0.2 / 1.4 / 5.2 min, against 0.5 / 3.3 / 8.7 min
for production NCF.

## Monte Carlo spread and consistency

- The fix helps consistently: it beat the old blend on the same population
  in 25 of 30 simulations (+2.2, +2.4, +1.1 points by batch).
- The fixed blend is less stable than the old one: sd 1.6-2.0 points against
  0.7-1.6. The cause is the next section's pattern: some runs stop after
  round 1 and some train 20-35 rounds, and those two groups score
  differently.

## Anomalies and patterns

**All 4 wins came from runs that stopped after round 1.** Early stopping on
accuracy kept the round-1 model in 13 of 30 runs. Those runs have a weak NCF
(56.7% alone on average) and won 4 of 13 times. The 17 runs that trained
longer have a stronger NCF (59.8% alone) and won 0 of 17 times, trailing tag
+ similarity by 3.8 points on average.

| Batch C sim | Best round | NCF alone | Fixed blend | Tag + sim |
|---|---|---|---|---|
| 1 | 1 | 61.8% | **79.1%** | 76.4% |
| 6 | 1 | 61.1% | **78.9%** | 77.5% |
| 2-5, 7-10 | 17-35 | 62-66% | 74.6-77.4% | 76.6-79.3% |

A better NCF makes the blend worse. The likely reason: production gives NCF
60% of the final score (`0.4 x base + 0.6 x NCF`). A barely trained NCF
gives nearly flat scores, so it only breaks ties between places with the same
tag score, and that helps. A trained NCF spreads its scores wide and
overrides the tag score, which on this data is the stronger signal.

The single diagnostic run that suggested this fix (simulation 1, 79.1%) was
one of the lucky round-1 runs. Across 10 simulations, batch C averages 76.4%.

Other patterns:

- The traveler types Mapr reads best and worst did not change: Birdwatcher,
  Nightlife Person, Outdoor Enthusiast best (87-89%); Generalist Explorer,
  Indecisive Tourist, Road Tripper worst (55-62%).
- Validation accuracy with same-city negatives peaked within 2 rounds in 11
  of the 20 batch A and B runs, so early stopping kept very young models
  there.

## Next test

Lower NCF's weight in the blend, or use it only to break ties: re-score the
same 30 simulations with weights 0.1, 0.2 and 0.3 instead of 0.6. If one wins
most of the 30, that plus the three fixes is the production change, and it
goes to every Mapr surface in one PR (CLAUDE.md).
