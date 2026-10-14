// Full-app simulation: thousands of seeded user sessions against a sim build
// of the app, the Firebase emulators, and canned /api answers.
// How to run: docs/app-sim-results.md.
//
//   node scripts/app-sim/run.mjs --sessions 2000 --workers 10 --seed 1
//
// Options:
//   --sessions N     total sessions (default 50)
//   --workers W      sessions in parallel (default 6)
//   --seed S         run seed; the same seed and session index repeat a session
//   --from N         first session index (split one seed's run into parts)
//   --only i,j       run only these session indexes (repro)
//   --base URL       where the sim build is served (default: starts `vite preview`)
//   --build          rebuild the sim bundle first (VITE_USE_EMULATOR=1, demo config)
//   --max-minutes M  stop starting new sessions after M minutes (default 110)
//   --fail-rate x    share of AI calls answered 503 (default 0.03)
//   --out DIR        output folder (default scripts/app-sim/out/run-<seed>)
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, chromiumPath } from './pw.mjs';
import { runSession, newSimContext, mulberry32, hashSeed } from './session.mjs';
import { buildReport } from './report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const SESSIONS = Number(arg('sessions', 50));
const WORKERS = Number(arg('workers', 6));
const SEED = String(arg('seed', '1'));
const FROM = Number(arg('from', 0));
const ONLY = arg('only', '') ? String(arg('only')).split(',').map(Number) : null;
const FAIL_RATE = Number(arg('fail-rate', 0.03));
const MAX_MS = Number(arg('max-minutes', 110)) * 60000;
const OUT = arg('out', join(here, 'out', `run-${SEED}${FROM ? `-from${FROM}` : ''}`));
let BASE = arg('base', '');

// Demo-only Firebase config: project demo-lh never reaches real Firebase,
// and VITE_USE_EMULATOR points every SDK at 127.0.0.1.
const SIM_ENV = {
  VITE_USE_EMULATOR: '1',
  VITE_FIREBASE_API_KEY: 'demo-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-lh.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-lh',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-lh.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
  VITE_FIREBASE_APP_ID: '1:1:web:1',
};
const DIST = join(here, '.dist');

async function up(url) {
  try {
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await up('http://127.0.0.1:9099/')) && !(await up('http://127.0.0.1:8080/'))) {
    console.error('Start the emulators first: node scripts/app-sim/start-emulators.mjs');
    process.exit(1);
  }
  if (arg('build', false) || !existsSync(join(DIST, 'index.html'))) {
    console.log('building sim bundle...');
    // Not minified, so stack traces name the app's functions.
    execSync(`npx vite build --outDir ${DIST} --emptyOutDir --minify false`, { cwd: root, stdio: 'inherit', env: { ...process.env, ...SIM_ENV } });
  }
  let preview = null;
  if (!BASE) {
    BASE = 'http://127.0.0.1:4173';
    if (!(await up(BASE))) {
      preview = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', '4173', '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
      for (let i = 0; i < 60 && !(await up(BASE)); i += 1) await new Promise((r) => setTimeout(r, 500));
    }
  }
  mkdirSync(OUT, { recursive: true });

  // Accounts made by new-user sessions, reused by returning-user sessions.
  const poolFile = join(here, 'out', 'accounts.json');
  // Only accounts this emulator still knows (it forgets everything on restart).
  const saved = existsSync(poolFile) ? JSON.parse(readFileSync(poolFile, 'utf8')) : [];
  const known = await Promise.all(
    saved.map((a) =>
      fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: a.email, password: a.password, returnSecureToken: true }),
      })
        .then((r) => r.ok)
        .catch(() => false)
    )
  );
  const accounts = saved.filter((_, i) => known[i]);
  console.log(`account pool: ${accounts.length} of ${saved.length} saved accounts still exist`);
  const pool = {
    size: () => accounts.length,
    addAccount: (a) => accounts.push(a),
    take: (rng) => (accounts.length ? accounts[Math.floor(rng() * accounts.length)] : null),
  };

  const indexes = ONLY || Array.from({ length: SESSIONS }, (_, i) => FROM + i);
  const results = [];
  let next = 0;
  const started = Date.now();
  const launch = () =>
    chromium.launch({
      executablePath: process.env.SIM_CHROMIUM || undefined,
      args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--mute-audio'],
    });
  // A few browsers, many contexts: one crashing browser loses only its share.
  const browsers = [];
  const perBrowser = 5;
  for (let i = 0; i < Math.ceil(WORKERS / perBrowser); i += 1) {
    try {
      browsers.push(await launch());
    } catch (e) {
      console.warn(`default chromium failed (${e.message.split('\n')[0]}); using ${chromiumPath()}`);
      process.env.SIM_CHROMIUM = chromiumPath();
      browsers.push(await launch());
    }
  }

  const opts = { failRate: FAIL_RATE, sessionTimeoutMs: 180000 };
  const progress = () => {
    const done = results.length;
    const mins = (Date.now() - started) / 60000;
    const f = results.reduce((s, r) => s + r.findings.filter((x) => x.kind !== 'harness').length, 0);
    process.stdout.write(`\r${done}/${indexes.length} sessions, ${mins.toFixed(1)} min, ${f} raw findings   `);
  };

  async function worker(w) {
    const bi = Math.floor(w / perBrowser);
    const contexts = {};
    let used = 0;
    const getContext = async (device) => {
      if (!browsers[bi].isConnected()) {
        browsers[bi] = await launch();
        for (const k of Object.keys(contexts)) delete contexts[k];
      }
      // A fresh context now and then keeps memory flat.
      if (used++ % 40 === 39) {
        for (const k of Object.keys(contexts)) {
          await contexts[k].close().catch(() => {});
          delete contexts[k];
        }
      }
      if (!contexts[device]) contexts[device] = await newSimContext(browsers[bi], device);
      return contexts[device];
    };
    while (next < indexes.length && Date.now() - started < MAX_MS) {
      const index = indexes[next++];
      try {
        await runSession({ getContext, base: BASE, index, seed: SEED, pool, out: results, opts });
      } catch (e) {
        results.push({ index, seed: SEED, status: 'crashed', actions: 0, ms: 0, steps: [], findings: [{ kind: 'harness', message: e.message, action: 0 }] });
        for (const k of Object.keys(contexts)) {
          await contexts[k].close().catch(() => {});
          delete contexts[k];
        }
      }
      progress();
      if (results.length % 50 === 0) {
        writeFileSync(poolFile, JSON.stringify(accounts));
        writeFileSync(join(OUT, 'sessions.partial.json'), JSON.stringify(results));
      }
    }
    for (const c of Object.values(contexts)) await c.close().catch(() => {});
  }
  // Stagger worker starts so the first page loads do not pile up.
  await Promise.all(Array.from({ length: WORKERS }, (_, w) => new Promise((r) => setTimeout(r, w * 700)).then(() => worker(w))));
  process.stdout.write('\n');
  for (const b of browsers) await b.close().catch(() => {});
  if (preview) preview.kill();

  writeFileSync(poolFile, JSON.stringify(accounts));
  results.sort((a, b) => a.index - b.index);
  writeFileSync(join(OUT, 'sessions.json'), JSON.stringify(results));
  const report = buildReport(results, { seed: SEED, ms: Date.now() - started, workers: WORKERS });
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report.json, null, 2));
  writeFileSync(join(OUT, 'report.md'), report.md);
  console.log(report.summary);
  console.log(`report: ${join(OUT, 'report.md')}`);
}

// Unused here; exported for one-off repro scripts.
export { mulberry32, hashSeed };

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
