// Combines the parts of one run (run.mjs --from) into one report.
//
//   node scripts/app-sim/merge.mjs out/run-big1 out/run-big1-from1000 --out out/big1
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildReport } from './report.mjs';

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const out = resolve(oi === -1 ? 'merged' : args[oi + 1]);
const dirs = args.filter((a, i) => a !== '--out' && i !== oi + 1);
let results = [];
let ms = 0;
let workers = 0;
let seed = '';
for (const d of dirs) {
  results = results.concat(JSON.parse(readFileSync(join(d, 'sessions.json'), 'utf8')));
  const r = JSON.parse(readFileSync(join(d, 'report.json'), 'utf8'));
  ms += r.ms;
  workers = Math.max(workers, r.workers || 0);
  seed = results[0]?.seed || seed;
}
results.sort((a, b) => a.index - b.index);
const report = buildReport(results, { seed, ms, workers });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'report.json'), JSON.stringify(report.json, null, 2));
writeFileSync(join(out, 'report.md'), report.md);
console.log(report.summary);
