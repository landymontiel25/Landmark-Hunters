#!/usr/bin/env node
// Writes the 0-5 slider ratings into src/data/miamiNeighborhoods.json from
// scripts/neighborhoods/metrics.json (see scripts/fetch-neighborhood-metrics.mjs).
// Scoring rules: src/lib/neighborhoodScoring.js. Only `ratings` changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { scoreNeighborhoods } from '../src/lib/neighborhoodScoring.js';

const FILE = 'src/data/miamiNeighborhoods.json';
const data = JSON.parse(readFileSync(FILE, 'utf8'));
const metrics = JSON.parse(readFileSync('scripts/neighborhoods/metrics.json', 'utf8'));
const scores = scoreNeighborhoods(metrics.neighborhoods);

let filled = 0;
for (const n of data.neighborhoods) {
  if (!scores[n.name]) continue;
  n.ratings = scores[n.name];
  filled += 1;
}
data.ratingsSource = { fetchedAt: metrics.fetchedAt, ...metrics.sources, method: 'src/lib/neighborhoodScoring.js' };
writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
console.log(`Scored ${filled} of ${data.neighborhoods.length} neighborhoods`);
