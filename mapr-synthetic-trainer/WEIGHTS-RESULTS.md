# NCF blend weight: 30-simulation re-score

Run of October 6, 2026, 1:18-1:39 AM ET. The same 30 simulated populations
as `RESULTS.md` and `FIX-RESULTS.md` (same seeds, same travelers, same
ratings), NCF trained with the three fixes (BPR on logits, same-city
negatives, early stopping on validation accuracy). Each simulation's blend is
scored at NCF weights 0.6, 0.3, 0.2 and 0.1:

    final = (1 - w) x normalized base + w x NCF

The 0.6 scores match the previous fixed run to the last digit (difference
0.0 in all 30), so every weight is compared on identical models and users.

Production's blend also clips negative base scores to 0 before mixing
(`Math.max(0, base) / maxBase` in `src/lib/maprRank/rank.js`). The quick test
before this run pointed at that clip, so each weight was also scored with the
sign kept (`base / max |base|`), marked "signed" below.

`node pipeline.js --fixed --blend-weights 0.6,0.3,0.2,0.1` with
`MAPR_OUT_DIR=output-weights`. Data: `output-weights/batch-{A,B,C}-results.json`
(rankers `mapr_w<w>` and `mapr_signed_w<w>`). Production code is unchanged.

## SIMPLE SUMMARY

- **Which weight wins?** None of 0.3, 0.2 or 0.1 wins on its own: the best
  beats tag + similarity in 9 of 30 runs. With one more change (stop
  clipping negative tag scores to 0), **0.2 wins**.
- **How many times does the winner beat tag + similarity?** 28 of 30 (signed
  blend at 0.2). Signed 0.1 wins 29 of 30 with a smaller margin; signed 0.3
  wins 26 of 30.
- **Should we deploy this weight?** Yes, as a staged rollout: the signed 0.2
  blend beat today's 0.6 formula in 28 of 30 runs and gave brand-new users
  their first real gain (68% vs 66% right). The gain over tag + similarity
  alone is under 1 point, and on synthetic travelers, so real users confirm
  it before it reaches everyone.

What to say:

- Lowering the neural part's weight alone was not enough.
- The tests found a second bug: the blend threw away "you probably won't
  like this" signals.
- Fixing that and lowering the weight to 0.2 made Mapr beat its simpler
  method in 28 of 30 tests, at every user count.
- Next: ship it to a share of users and compare.

## Results

Held-out pairwise accuracy (share of loved-vs-not-loved place pairs ordered
right; 50% = coin flip), mean over 10 simulations per batch; wins = runs
where the blend beats tag + similarity on the same simulation.

Tag + similarity: A 78.1%, B 77.7%, C 77.7%.

| Weight | Batch A (1k) | Batch B (5k) | Batch C (10k) | Wins / 30 |
|---|---|---|---|---|
| 0.6 (today) | 72.9% (0/10) | 76.2% (2/10) | 76.4% (2/10) | 4 |
| 0.3 | 74.9% (0/10) | 77.4% (3/10) | 78.0% (6/10) | 9 |
| 0.2 | 75.1% (0/10) | 77.4% (3/10) | 78.1% (6/10) | 9 |
| 0.1 | 75.2% (0/10) | 77.4% (3/10) | 78.0% (5/10) | 8 |
| signed 0.6 | 76.2% (0/10) | 77.8% (6/10) | 77.7% (2/10) | 8 |
| signed 0.3 | 78.0% (6/10) | **78.4% (10/10)** | **78.6% (10/10)** | 26 |
| **signed 0.2** | **78.2% (8/10)** | **78.3% (10/10)** | **78.5% (10/10)** | **28** |
| signed 0.1 | **78.3% (9/10)** | 78.2% (10/10) | 78.2% (10/10) | 29 |

Margin over tag + similarity (mean, worst run):

| Weight | Batch A | Batch B | Batch C |
|---|---|---|---|
| 0.2 | -3.1 (-4.0) | -0.3 (-1.0) | +0.4 (-0.7) |
| signed 0.3 | -0.1 (-0.6) | +0.7 (+0.1) | +0.8 (+0.3) |
| signed 0.2 | +0.1 (-0.2) | +0.6 (+0.2) | +0.8 (+0.4) |
| signed 0.1 | +0.2 (-0.1) | +0.4 (+0.2) | +0.5 (+0.4) |

Held-out NDCG@10 at batch C: signed 0.2 and 0.3 0.789, tag + similarity
0.787, 0.6 0.775.

## Comparison to the current 0.6 weight

- Lower weight alone beat 0.6 in 9-10 of 10 runs per batch, by +2.1 points
  at 1k, +1.2 at 5k and +1.7 at 10k (0.2 vs 0.6).
- Signed 0.2 beat clipped 0.6 in 28 of 30 runs: +5.3 points at 1k, +2.1 at
  5k, +2.1 at 10k. The two losses are batch C simulations 1 and 6, the runs
  whose barely trained NCF gave 0.6 its only wins (`FIX-RESULTS.md`).
- Against the production NCF before any fix (75.2% at 10k, `RESULTS.md`),
  the fixed NCF with the signed 0.2 blend is +3.2 points.

## New users (500 never trained on, 5 ratings known)

| | Batch A | Batch B | Batch C |
|---|---|---|---|
| Mapr today (tag + similarity) | 66.4% | 66.4% | 66.4% |
| 0.2 | 63.6% (0/10) | 65.9% (3/10) | 65.5% (2/10) |
| signed 0.2 | 66.9% (10/10) | 68.1% (10/10) | 67.9% (10/10) |

The clip hurt new users most: with only 5 ratings, most places have a
negative or zero tag score, and the clip turned them into ties. Keeping the
sign is what makes the neural part help a newcomer: +1.5 points at 10k, in
all 10 runs.

## Patterns by batch size

- **1,000 users:** NCF is weak (53% alone), so less weight is better; signed
  0.1 is the top weight. Plain lower weights stay 3 points behind tag +
  similarity because of the clip.
- **5,000 and 10,000 users:** signed 0.3 and 0.2 win all 20 runs; 0.3 has the
  highest average (78.4%, 78.6%), 0.2 the smaller spread at 1k. As NCF
  improves with data, the best weight rises.
- **Spread:** sd about 0.7 points for signed 0.1-0.3, against 1.6-2.0 for
  0.6. A small NCF weight also removes the run-to-run swings that early
  stopping caused.
- 0.2 is the safest single choice: it never trails tag + similarity by more
  than 0.2 points in any of the 30 runs and wins every run at 5k and 10k.

## What a production change would be

Changes to `src/lib/maprRank/` (both change how Mapr learns and ranks, so
they ship together to every Mapr surface in one PR, per CLAUDE.md):

1. NCF training (`ncf.js`, `config.js`): BPR on logits, negatives from the
   user's region, early stopping on validation accuracy.
2. Blend (`rank.js`, `config.js`): `0.8 x base / max |base| + 0.2 x NCF`,
   keeping negative bases.

NCF is still inactive in production (it switches on above 10 active users).
Today's 0.6 clipped formula would make Mapr worse the day it switches on
(-1.4 points at 10k users in these simulations). With this change it helps
from that day.
