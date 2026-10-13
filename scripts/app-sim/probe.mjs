// Targeted checks for problems the simulation found, run against the same
// sim build and emulators. Each probe prints PASS or FAIL with what it saw;
// docs/app-sim-results.md names the probe for each bug.
//
//   node scripts/app-sim/probe.mjs [name ...]     (no name: run all)
import { chromium } from './pw.mjs';
import { newSimContext } from './session.mjs';
import { makeRouter, adminSet } from './stubs.mjs';
import { periodKeysAt } from '../../src/lib/periods.js';

const BASE = process.env.SIM_BASE || 'http://127.0.0.1:4173';
const rnd = () => Math.random();

async function setup(browser, { device = 'phone', geo = null } = {}) {
  const context = await newSimContext(browser, device);
  context.__simRouter = makeRouter({ rng: rnd, base: BASE, stats: { api: {}, unknownApi: {}, external: {}, requests: 0 }, failRate: 0 });
  await context.grantPermissions(geo ? ['geolocation'] : [], { origin: BASE });
  if (geo) await context.setGeolocation(geo);
  const page = await context.newPage();
  context.__simPage = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { context, page, errors };
}

async function signUp(page, name = 'Probe User') {
  const email = `probe-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto(`${BASE}/#/profile`);
  await page.getByText('New here? Create an Account').click();
  await page.fill('#name', name);
  await page.fill('#email', email);
  await page.fill('#password', 'simpass123');
  await page.check('input[name="age-confirmed"]');
  await page.click('form button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('#password'), null, { timeout: 15000 });
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'simpass123', returnSecureToken: true }),
  });
  return { email, uid: (await r.json()).localId };
}

const PROBES = {
  // Tapping a name on the full leaderboard on a phone opens the small
  // profile card (it opened on the emulated hover and closed on the tap).
  async 'leaderboard-tap'(browser) {
    const { page, context } = await setup(browser);
    const me = await signUp(page);
    const key = periodKeysAt(Date.now(), new Date().getTimezoneOffset()).weekly;
    const other = `probeOther${Date.now()}`;
    await adminSet(`users/${other}`, { displayName: 'Other Hunter', username: `other${Date.now() % 100000}`, public: true });
    await adminSet(`leaderboard_entries/weekly_${key}_${other}`, { period: 'weekly', periodKey: key, userId: other, userName: 'Other Hunter', points: 50 });
    await adminSet(`leaderboard_entries/weekly_${key}_${me.uid}`, { period: 'weekly', periodKey: key, userId: me.uid, userName: 'Probe User', points: 10 });
    await page.evaluate(() => (location.hash = '/leaderboard/full?period=weekly'));
    const name = page.locator('.user-popover-trigger', { hasText: 'Other Hunter' }).first();
    await name.waitFor({ timeout: 10000 });
    await name.tap();
    await page.waitForTimeout(600);
    const open = await page.locator('.user-popover-card').count();
    await context.close();
    return open > 0 ? 'PASS card opened on tap' : 'FAIL tap left the card closed';
  },
};

const browser = await chromium.launch();
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PROBES);
let failed = 0;
for (const n of names) {
  try {
    const r = await PROBES[n](browser);
    if (r.startsWith('FAIL')) failed += 1;
    console.log(`${n}: ${r}`);
  } catch (e) {
    failed += 1;
    console.log(`${n}: ERROR ${e.message.split('\n')[0]}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
