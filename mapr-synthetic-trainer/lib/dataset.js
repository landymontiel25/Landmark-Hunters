import { generateUser, populationPlan } from '../synthetic-users.js';
import { simulateUser } from '../interaction-simulator.js';

// One simulation's full population: users plus every interaction in flat
// typed arrays (500k rows fit in a few MB). User n's rows are
// [start[n], start[n + 1]). Batches A/B/C are prefixes of the same
// population (first 1k, 5k, 10k users), so B contains A and C contains B.

export const PER_USER = 50;

// Places with enough examples to make a personal quirk visible.
export function quirkFeatures(catalog, min = 15) {
  return [...catalog.featureCounts].filter(([, c]) => c >= min).map(([f]) => f).sort();
}

// Cold-start users are numbered from coldOffset (past the largest batch), so
// every batch of a simulation is tested on the same never-trained users.
export const COLD_OFFSET = 10_000;

export function buildDataset(catalog, { seed, variation, users: nUsers, coldUsers = 0, coldOffset = COLD_OFFSET, onProgress = null, progressEvery = 250 }) {
  const plan = populationPlan(seed, variation);
  const feats = quirkFeatures(catalog);
  const total = nUsers + coldUsers;
  const users = new Array(total);
  const start = new Int32Array(total + 1);
  const user = new Int32Array(total * PER_USER);
  const item = new Int32Array(total * PER_USER);
  const rating = new Int8Array(total * PER_USER); // 0 = skipped
  const love = new Uint8Array(total * PER_USER);
  let row = 0;
  for (let n = 0; n < total; n++) {
    const u = generateUser(n < nUsers ? n : coldOffset + (n - nUsers), plan, feats);
    const rows = simulateUser(u, catalog, { perUser: PER_USER, seed, noiseScale: variation.noiseScale });
    users[n] = u;
    start[n] = row;
    for (const r of rows) {
      user[row] = n;
      item[row] = r.item;
      rating[row] = r.skip ? 0 : r.rating;
      love[row] = r.love ? 1 : 0;
      row++;
    }
    if (onProgress && ((n + 1) % progressEvery === 0 || n + 1 === total)) onProgress({ users: n + 1, total, interactions: row, last: u });
  }
  start[total] = row;
  return { seed, plan, users, start, user: user.subarray(0, row), item: item.subarray(0, row), rating: rating.subarray(0, row), love: love.subarray(0, row), trainUsers: nUsers, coldUsers };
}

// Implicit positive, same rule as production's NCF.positives: a loved
// place, or a top-tier rating ("highly recommend" = 4-5 stars here).
export const isPositive = (ds, r) => ds.love[r] === 1 || ds.rating[r] >= 4;
