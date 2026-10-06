import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { seededRandom } from '../src/lib/maprRank/experiments.js';
import { NCF as PROD_NCF, COLLAB_LIKED_MIN_STARS } from '../src/lib/maprRank/config.js';
import { collabBoost } from '../src/lib/maprRank/similarity.js';
import { NCFModel } from './ncf-model.js';
import { computeSimilarity, matrixBytes } from './similarity-matrix.js';
import { archetypeTagPriors, featureLift, tagScore, userTagProfile } from './tag-scoring.js';
import { MetricSum, gradedNdcg, pairwiseAccuracy, rankingMetrics } from './evaluator.js';
import { isPositive } from './lib/dataset.js';
import { trueMatch } from './interaction-simulator.js';
import { LAB_USERS, buildLab, labSnapshot } from './lib/lab.js';

// One training run: the first `nUsers` users of a simulated population,
// every Mapr component trained on them, then evaluated.
//
// Each user's 50 interactions are split by order (the places were drawn at
// random, so order is random too):
//   steps  0-34  train (70%)   NCF, similarity, tag scores and popularity learn from these
//   steps 35-39  validation    early stopping only
//   steps 40-49  test (20%)    held out; never seen by any component
// Evaluation users: up to EVAL_USERS of the batch (spec: 2,000).
// Cold-start users: the dataset's extra users past the training population,
// never trained on. Mapr sees their first COLD_REVEAL interactions (an
// onboarding) and is scored on the other 45.

export const TRAIN_STEPS = 35;
export const VAL_END = 40;
export const EVAL_USERS = 2000;
export const COLD_REVEAL = 5;
const LIKED_TIER_STARS = 5; // a "highly recommend" (rank.js TIER_STARS)

export const RANKERS = {
  random: 'Random order (sanity floor)',
  popularity: 'Most-liked places first (what a brand-new user gets)',
  tag: 'Tag score (tagScores.js + kindBoost)',
  tag_sim: 'Tag score x item-item similarity boost (Weeks 1-2)',
  ncf: 'NCF alone (Week 3 model)',
  mapr: 'Full Mapr blend: 0.4 x base + 0.6 x NCF',
  oracle: "True taste, no noise (ceiling: the simulator's own match score)",
};

export async function runBatch({ catalog, ds, nUsers, batch, sim, ncfConfig = {}, evalUsers = EVAL_USERS, onEpoch = null, onLab = null, log = () => {}, exportDir = null }) {
  const started = Date.now();
  const places = catalog.places;
  const numItems = places.length;
  const rowsOf = (n) => {
    const out = [];
    for (let r = ds.start[n]; r < ds.start[n + 1]; r++) out.push(r);
    return out;
  };

  // ---- Training data ------------------------------------------------------
  const trainPos = [];
  const trainPositivesOf = Array.from({ length: nUsers }, () => new Set());
  const allPositivesOf = Array.from({ length: nUsers }, () => new Set());
  const popCount = new Float64Array(numItems);
  const simPositives = [];
  let interactions = 0;
  for (let n = 0; n < nUsers; n++) {
    rowsOf(n).forEach((r, step) => {
      interactions++;
      if (!isPositive(ds, r)) return;
      const i = ds.item[r];
      allPositivesOf[n].add(i);
      if (step < TRAIN_STEPS) {
        trainPositivesOf[n].add(i);
        trainPos.push(n, i);
        popCount[i]++;
        simPositives.push({ userId: n, place: places[i] });
      }
    });
  }
  // Production indexes only places with a training positive; negatives come
  // from those, and any other place gets the request's mean NCF score.
  const hasEmbedding = new Uint8Array(numItems);
  for (let p = 1; p < trainPos.length; p += 2) hasEmbedding[trainPos[p]] = 1;
  const pool = Int32Array.from([...hasEmbedding.keys()].filter((i) => hasEmbedding[i]));

  // Negatives: production samples from every place with an embedding; the
  // 'area' diagnostic samples from the user's own area only.
  const areaPools = {};
  for (const [area, idxs] of Object.entries(catalog.byArea)) areaPools[area] = Int32Array.from(idxs.filter((i) => hasEmbedding[i]));
  const sameArea = ncfConfig.negative_sampling === 'area';
  const negativePool = sameArea ? (u) => areaPools[ds.users[u].city] : () => pool;

  const rng = seededRandom(ds.seed * 101 + nUsers);
  const valList = [];
  for (let n = 0; n < nUsers; n++) {
    rowsOf(n).forEach((r, step) => {
      if (step < TRAIN_STEPS || step >= VAL_END || !isPositive(ds, r)) return;
      const i = ds.item[r];
      if (!hasEmbedding[i] || trainPositivesOf[n].has(i)) return;
      for (let q = 0; q < PROD_NCF.negativesPerPositive; q++) {
        let j;
        let guard = 0;
        const vp = negativePool(n);
        do j = vp[Math.floor(rng() * vp.length)];
        while (allPositivesOf[n].has(j) && ++guard < 1000);
        if (!allPositivesOf[n].has(j)) valList.push(n, i, j);
      }
    });
  }
  const valTriples = Int32Array.from(valList);
  log(`Batch ${batch} sim ${sim}: ${nUsers.toLocaleString()} users, ${interactions.toLocaleString()} interactions, ${(trainPos.length / 2).toLocaleString()} training positives, ${(valTriples.length / 3).toLocaleString()} validation triples`);

  // ---- Similarity -----------------------------------------------------------
  const sim0 = Date.now();
  const similarity = computeSimilarity(catalog, simPositives);
  const similarityMs = Date.now() - sim0;

  const order = Array.from({ length: nUsers }, (_, n) => n);
  const erng = seededRandom(ds.seed * 13 + 7);
  for (let t = order.length - 1; t > 0; t--) {
    const s = Math.floor(erng() * (t + 1));
    [order[t], order[s]] = [order[s], order[t]];
  }
  const evalSet = order.slice(0, Math.min(evalUsers, nUsers));

  // Tag score and base (tag x similarity boost) of a place for a user, from
  // the rows Mapr knows about. Same as production rank.js minus distance.
  const baseScorer = (known) => {
    const profile = userTagProfile(known.map((r) => ({ place: places[ds.item[r]], rating: ds.rating[r], love: ds.love[r] === 1 })));
    const likedByRegion = {};
    for (const r of known) {
      const stars = ds.love[r] || ds.rating[r] >= 4 ? LIKED_TIER_STARS : ds.rating[r] === 3 ? 3 : 1;
      if (stars < COLLAB_LIKED_MIN_STARS) continue;
      const p = places[ds.item[r]];
      (likedByRegion[p.region] ||= []).push(p.id);
    }
    return (i) => {
      const p = places[i];
      const t = tagScore(profile, p);
      const nb = similarity.regions[p.region];
      const boost = nb ? collabBoost(nb, p.id, (likedByRegion[p.region] || []).filter((id) => id !== p.id)) : 0;
      return { tag: t, base: t >= 0 ? t * (1 + boost) : t / (1 + boost) };
    };
  };

  // ---- Testing lab (dashboard only) --------------------------------------
  let lab = null;
  if (onLab) {
    const labUsers = evalSet.slice(0, LAB_USERS).map((n) => {
      const rows = rowsOf(n);
      const known = rows.slice(0, TRAIN_STEPS);
      const val = rows.slice(TRAIN_STEPS, VAL_END);
      const score = baseScorer(known);
      const knownItems = new Set(known.map((r) => ds.item[r]));
      let maxBase = 0;
      for (const i of catalog.byArea[ds.users[n].city]) if (!knownItems.has(i)) maxBase = Math.max(maxBase, score(i).base);
      return { n, user: ds.users[n], likedRows: val.filter((r) => isPositive(ds, r)), otherRows: val.filter((r) => !isPositive(ds, r)), baseOf: new Map(val.map((r) => [ds.item[r], score(ds.item[r]).base])), maxBase };
    });
    lab = buildLab({ ds, places, users: labUsers });
  }

  // ---- NCF ----------------------------------------------------------------
  const ncf = new NCFModel(ncfConfig).init(nUsers, numItems);
  if (lab) onLab(labSnapshot(lab, ncf, { batch, sim, epoch: 0 }));
  const t0 = Date.now();
  const training = await ncf.train({
    positives: Int32Array.from(trainPos),
    positivesOf: trainPositivesOf,
    valTriples,
    negativePool,
    onEpoch: (row) => {
      onEpoch?.(row);
      if (lab) onLab(labSnapshot(lab, ncf, { batch, sim, epoch: row.epoch }));
    },
  });
  const ncfMs = Date.now() - t0;
  ncf.prepareRanking();

  // ---- Evaluation -----------------------------------------------------------
  const ev0 = Date.now();
  const sums = Object.fromEntries(Object.keys(RANKERS).map((k) => [k, new MetricSum()]));
  const byArchetype = new Map();
  const scoreBuf = new Float64Array(2000);

  const rankUser = ({ user, known, test, userVec, sumsFor, archetypeSums = null }) => {
    const knownItems = new Set(known.map((r) => ds.item[r]));
    const testPos = new Set(test.filter((r) => isPositive(ds, r)).map((r) => ds.item[r]));
    const testItems = test.map((r) => ds.item[r]);
    const cand = catalog.byArea[user.city].filter((i) => !knownItems.has(i));
    const urng = seededRandom(ds.seed * 1_000_003 + user.n * 7 + 3);
    for (let t = cand.length - 1; t > 0; t--) {
      const s = Math.floor(urng() * (t + 1));
      [cand[t], cand[s]] = [cand[s], cand[t]];
    }
    const rel = cand.map((i) => (testPos.has(i) ? 1 : 0));
    const posOf = new Map(cand.map((i, k) => [i, k]));
    const testIdx = testItems.map((i) => posOf.get(i));
    const testPositive = testItems.map((i) => testPos.has(i));
    // Graded gain per held-out place: skip or 2 stars 0, 3 stars 1, 4 stars 2,
    // 5 stars 3, plus 1 for a love.
    const testGain = test.map((r) => Math.max(0, ds.rating[r] - 2) + ds.love[r]);

    const score = baseScorer(known);
    const scored = cand.map((i) => score(i));
    const tag = scored.map((x) => x.tag);
    const base = scored.map((x) => x.base);
    let ncfScores = null;
    if (userVec) {
      const buf = scoreBuf.length >= cand.length ? scoreBuf : new Float64Array(cand.length);
      ncf.scoreItemsFor(userVec, cand, buf);
      let sum = 0;
      let cnt = 0;
      for (let k = 0; k < cand.length; k++) {
        if (!hasEmbedding[cand[k]]) continue;
        sum += buf[k];
        cnt++;
      }
      const mean = cnt ? sum / cnt : 0.5;
      ncfScores = cand.map((i, k) => (hasEmbedding[i] ? buf[k] : mean));
    }
    const maxBase = Math.max(0, ...base);
    const scores = {
      random: cand.map(() => urng()),
      popularity: cand.map((i) => popCount[i]),
      tag,
      tag_sim: base,
      ncf: ncfScores,
      mapr: ncfScores ? cand.map((_, k) => PROD_NCF.baseWeight * (maxBase > 0 ? Math.max(0, base[k]) / maxBase : 0) + PROD_NCF.ncfWeight * ncfScores[k]) : null,
      oracle: cand.map((i) => trueMatch(user, places[i].features)),
    };
    for (const [name, s] of Object.entries(scores)) {
      if (!s || !sumsFor[name]) continue;
      const rm = rankingMetrics(s, rel);
      const testScores = testIdx.map((k) => s[k]);
      const pa = pairwiseAccuracy(testScores, testPositive);
      const hn = gradedNdcg(testScores, testGain);
      for (const target of archetypeSums ? [sumsFor, archetypeSums] : [sumsFor]) {
        target[name] ||= new MetricSum();
        target[name].addRanking(rm);
        target[name].addPairs(pa);
        target[name].addHeldOut(hn);
      }
    }
  };

  for (const n of evalSet) {
    const user = ds.users[n];
    const rows = rowsOf(n);
    if (!byArchetype.has(user.archetype)) byArchetype.set(user.archetype, { users: 0, sums: {} });
    const a = byArchetype.get(user.archetype);
    a.users++;
    rankUser({ user, known: rows.slice(0, TRAIN_STEPS), test: rows.slice(VAL_END), userVec: ncf.userVector(n), sumsFor: sums, archetypeSums: a.sums });
  }

  // Cold start: users the model never saw.
  const coldSums = Object.fromEntries(['popularity', 'tag', 'tag_sim', 'ncf', 'mapr', 'oracle'].map((k) => [k, new MetricSum()]));
  let foldedIn = 0;
  for (let n = ds.trainUsers; n < ds.trainUsers + ds.coldUsers; n++) {
    const user = ds.users[n];
    const rows = rowsOf(n);
    const known = rows.slice(0, COLD_REVEAL);
    const likedItems = known.filter((r) => isPositive(ds, r)).map((r) => ds.item[r]).filter((i) => hasEmbedding[i]);
    if (likedItems.length) foldedIn++;
    const vec = ncf.foldIn(likedItems, pool, { seed: n });
    rankUser({ user, known, test: rows.slice(COLD_REVEAL), userVec: vec, sumsFor: coldSums });
  }
  const evalMs = Date.now() - ev0;

  const rankers = Object.fromEntries(Object.entries(sums).map(([k, s]) => [k, s.result()]));
  const cold = Object.fromEntries(Object.entries(coldSums).map(([k, s]) => [k, s.result()]));
  const archetypes = {};
  for (const [name, a] of byArchetype) archetypes[name] = { users: a.users, ...Object.fromEntries(Object.entries(a.sums).filter(([k]) => ['ncf', 'mapr', 'tag_sim', 'oracle'].includes(k)).map(([k, s]) => [k, s.result()])) };

  const result = {
    batch,
    sim,
    seed: ds.seed,
    variation: ds.plan.variation,
    users: nUsers,
    interactions,
    training_positives: trainPos.length / 2,
    places_with_embedding: pool.length,
    eval_users: evalSet.length,
    cold_users: ds.coldUsers,
    cold_users_with_a_like: foldedIn,
    ncf: {
      best_epoch: training.bestEpoch,
      epochs_run: training.history.length,
      stopped_by: training.stoppedBy,
      best_val_loss: training.bestLoss,
      final_val_accuracy: training.history[training.bestEpoch - 1]?.valAccuracy ?? null,
      history: training.history.map((h) => ({ epoch: h.epoch, train_loss: h.trainLoss, val_loss: h.valLoss, val_accuracy: h.valAccuracy })),
      ms: ncfMs,
    },
    similarity: { ms: similarityMs, bytes: matrixBytes(similarity.regions), rows: Object.values(similarity.regions).reduce((s, r) => s + Object.keys(r).length, 0) },
    rankers,
    cold,
    archetypes,
    timing: { total_ms: Date.now() - started, ncf_ms: ncfMs, similarity_ms: similarityMs, eval_ms: evalMs },
  };

  if (exportDir) {
    const userIds = ds.users.slice(0, nUsers).map((u) => u.user_id);
    const itemIds = places.map((p) => `${p.region}/${p.id}`);
    // Export only places that have an embedding, like production.
    const exported = ncf.export({ users: userIds, items: itemIds, meta: { trainedOn: 'synthetic', batch, sim, seed: ds.seed, users: nUsers, version: `synthetic-${batch}-${sim}` } });
    exported.shared.items = Object.fromEntries(Object.entries(exported.shared.items).filter(([k]) => hasEmbedding[itemIds.indexOf(k)]));
    writeFileSync(path.join(exportDir, 'trained-ncf-model.json'), JSON.stringify({ ...exported, training: result.ncf, evaluation: rankers.ncf }));
    writeFileSync(path.join(exportDir, 'trained-similarity-matrix.json'), JSON.stringify({ trainedOn: 'synthetic', batch, sim, users: nUsers, stats: similarity.stats, regions: similarity.regions }));
    const lift = featureLift(ds, catalog, nUsers, isPositive);
    writeFileSync(
      path.join(exportDir, 'trained-tag-scores.json'),
      JSON.stringify(
        {
          trainedOn: 'synthetic',
          batch,
          sim,
          users: nUsers,
          note: 'feature_lift: how much more often places with a feature were loved or rated 4-5 than the average place. archetype_priors: mean production tag score per archetype after 50 interactions. place_popularity: training positives per place.',
          feature_lift: lift,
          archetype_priors: archetypeTagPriors(ds, catalog, nUsers),
          place_popularity: Object.fromEntries(places.filter((p) => popCount[p.idx] > 0).map((p) => [`${p.region}/${p.id}`, popCount[p.idx]])),
        },
        null,
        1
      )
    );
    result.feature_lift_top = lift.slice(0, 15);
    result.feature_lift_bottom = lift.slice(-10);
  }
  return result;
}
