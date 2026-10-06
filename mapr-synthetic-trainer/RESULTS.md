# Results: Mapr on 10,000 synthetic travelers

Full run of October 6, 2026: 3 batches x 10 Monte Carlo simulations = 30
training runs, 500,000 interactions per simulation, production Mapr code
(`src/lib/maprRank/`). Data: `output/learning-curve.csv`,
`output/final-report.csv`, `output/summary.json`,
`output/batch-{A,B,C}-results.json`. Rebuild with `npm run train`.

**Accuracy** = held-out pairwise accuracy: for each test user, every pair of
(a place they loved or rated 4-5, a place they rated lower or skipped) from
the 10 places Mapr never saw; the share Mapr orders right. 50% is a coin
flip. Mean +- sd over 10 simulations.

## Learning curve

| | 1,000 users (A) | 5,000 users (B) | 10,000 users (C) |
|---|---|---|---|
| NCF alone | 52.1% +- 1.0 | 56.7% +- 1.1 | 58.9% +- 1.9 |
| Full Mapr blend (0.4 base + 0.6 NCF) | 70.7% +- 1.6 | 73.8% +- 0.7 | 75.2% +- 0.9 |
| Tag score + similarity (no NCF) | 78.1% +- 0.7 | 77.7% +- 0.7 | 77.7% +- 0.8 |
| Tag score alone | 77.7% | 77.3% | 77.3% |
| Popularity (what a stranger gets) | 56.1% | 60.2% | 61.8% |
| Random | 50.2% | 49.9% | 50.3% |
| True taste, no noise (ceiling) | 95.2% | 95.4% | 95.4% |

Held-out NDCG@10 (graded by stars, over each user's 10 test places), batch C:
full blend 0.777, tag + similarity 0.787, NCF 0.708, random 0.681, ceiling 0.885.

## What it shows

1. **NCF learns from more users.** +6.8 points from 1,000 to 10,000 users,
   with diminishing returns (+4.6, then +2.2). Training loss fell in every
   run (0.65-0.69 at epoch 1 to 0.48-0.55 at the end).
2. **NCF does not yet beat the simpler parts of Mapr.** At every scale the
   full blend scores below tag score + similarity alone (75.2% vs 77.7% at
   10,000 users). Production gives NCF 60% of the final score, so today it
   pulls good tag-score rankings down. The gap shrinks with data (7.4
   points at 1k, 2.5 at 10k) but does not close inside this range.
3. **Production NCF has a training defect.** It applies BPR to sigmoid
   outputs, `softplus(-(sigmoid(z_i) - sigmoid(z_j)))`. Within 8 epochs the
   logits reach a median of -20 and a 5th percentile of -55, the sigmoid
   saturates, and the gradients vanish. Most runs stop on early stopping at
   20-40 epochs with validation accuracy near 60-65%. The tiny gradients also
   push Adam's state into subnormal floats, which made each epoch 4-5x
   slower in plain JS (the trainer flushes them to zero; the nightly job's
   30 s budget pays that cost today). Fixing it, together with sampling
   negatives from the user's own city, lifted the blend above tag +
   similarity in a first diagnostic run (below).
4. **Pre-training does not help brand-new users yet.** For 500 users never
   trained on, with 5 known ratings, Mapr today (tag + similarity) scores
   66.4%. Folding them into the pre-trained NCF scores 66.0% with the 10k
   model, 65.5% with 5k, 63.3% with 1k. Pre-training narrows the cold-start
   cost of NCF but adds nothing over today's cold start.
5. **Monte Carlo spread stays small** (sd 0.5-1.9 points), so the curve is
   not noise. It does not narrow for NCF from B to C (1.1 to 1.9): three of
   ten batch C runs trained all 50 epochs and seven stopped early, and that
   split widens the spread.
6. **Mapr understands some travelers far better than others** (full blend,
   batch C, about 150-200 test users each):
   - Best: Outdoor Enthusiast 88.2%, Religious Heritage Traveler 86.4%,
     Birdwatcher 86.2%, Nightlife Person 86.0%, Pub Crawler 85.9%.
   - Worst: Generalist Explorer 56.2%, Indecisive Tourist 58.5%, Road
     Tripper 60.6%, Sushi Devotee 62.4%, Street Food Grazer 62.6%.
   - Broad, inconsistent tastes are hardest. Sushi Devotee is hard for a
     different reason: only 40 sushi places exist, so most of their 50
     random places say little about them.
   - Asked-about types: Italian Foodie 72.4%, Outdoor Enthusiast 88.2%,
     Budget Backpacker 65.5%, Beach Vacationer 79.0%, History Buff 84.5%.

## Diagnostics

`node experiments.js` re-trains simulation 1 of batches A and C with one
production choice changed at a time. Production code and config stay as
they are. One simulation each, so read differences under 2 points as noise.
Data: `output/experiments.json`.

Batch C, 10,000 users, simulation 1:

| NCF training | NCF alone | Full blend | Tag + sim | New users (blend) | NCF train time |
|---|---|---|---|---|---|
| Production: BPR on sigmoid outputs, negatives from any city | 60.7% | 75.5% | 76.4% | 67.0% | 11.3 min, 46 epochs |
| BPR on logits | 62.4% | 77.2% | 76.4% | 65.2% | 2.2 min |
| Negatives from the user's own city | 61.9% | 74.5% | 76.4% | 66.8% | 1.3 min |
| Both | 61.8% | **79.1%** | 76.4% | **67.8%** | 1.2 min |

New users' "Mapr today" (tag + similarity) on the same simulation: 67.2%.

- With both changes, the full blend beats tag + similarity (+2.7 points),
  the first configuration where NCF adds to Mapr instead of taking away.
  Held-out NDCG@10 agrees: 0.790 vs 0.784. New users gain 0.6 points over
  today, within noise.
- Same-city negatives matter because production samples negatives from
  every city: a Miami traveler's "not liked" examples are mostly Milan and
  San Francisco places, so the model learns geography, which the app
  already knows, instead of taste.
- Early stopping is the next problem. It watches validation loss, and with
  BPR on logits the loss rises from epoch 2 (the model grows confident)
  while validation ranking accuracy keeps rising (63.6% to 89.9% in the
  logit run). In 4 of the 6 diagnostic runs it kept the epoch-1 model, and
  at 1,000 users every variant ended near 50% for NCF alone for that
  reason. Stopping on validation accuracy would keep the better models.
- Next step before any production change: rerun all 10 simulations per
  batch with BPR on logits, same-city negatives and early stopping on
  validation accuracy, and change production only if the blend beats tag +
  similarity across them. That change touches how Mapr learns, so it goes
  to every Mapr surface in one PR (CLAUDE.md).

## Caveats

- The travelers are synthetic. Their taste is a weighted sum of place
  features plus noise, which is exactly what tag scoring models, so this
  test favours tag scoring. Real people are less tidy; treat the ranking of
  methods as a signal and the absolute numbers as the simulator's, not
  Landmark Hunters'.
- The spec's simulator never gives 1 star (anything not skipped gets 2+),
  and 4.2% of interactions are skips.
- Each user meets 50 random places from their area. Real users choose where
  they go, which gives a recommender more signal.
- Catalog metrics (NDCG@10 0.071, Recall@10 0.119 for the blend over every
  unseen place in the area) are low for every method, the ceiling included
  (0.121), because most unseen places carry no rating.

## For the portfolio

Numbers that hold up:

- 10,000 synthetic travelers from 111 archetypes, 500,000 interactions with
  3,174 real Landmark Hunters places, trained offline with the production
  recommendation code; 30 Monte Carlo training runs.
- Mapr's neural model improved from 52.1% to 58.9% held-out pairwise
  accuracy as training users grew from 1,000 to 10,000; the full
  recommender reached 75.2% +- 0.9.
- The simulation found a defect in the production model's loss (saturating
  sigmoid BPR) and showed that the neural component currently lowers
  ranking quality versus the tag-and-similarity ranker (75.2% vs 77.7%).
- In a first diagnostic run, fixing the loss and sampling negatives from the
  traveler's own city lifted the full recommender to 79.1%, above the
  tag-and-similarity ranker (76.4%) on the same population.

Two paragraphs:

> Landmark Hunters recommends places with Mapr, which blends a tag-based
> taste score, item-to-item similarity and a neural collaborative filtering
> model. A neural model needs many users before it helps, and the app has
> few, so we built an offline lab: 10,000 synthetic travelers drawn from
> 111 personality types rated 500,000 visits to the app's real places, and
> we trained the production code on 1,000, 5,000 and 10,000 of them, ten
> times each with different random populations, scoring every run on
> ratings it never saw.
>
> The neural model learned (52% to 59% pairwise accuracy, tight across
> simulations), but the full recommender still ranked places worse than
> its simpler tag-and-similarity core (75% vs 78%), and pre-training gave
> brand-new users no lift. The lab traced much of the gap to a saturating
> loss in the production model and to negative examples drawn from the
> wrong cities; fixing both put the full recommender ahead (79% vs 76%) in a
> first test. That is the value of the exercise: a cheap,
> repeatable test that measures each part of the recommender before real
> users pay for its mistakes.
