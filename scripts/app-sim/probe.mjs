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

// Elements that stick out past a 390px phone screen, outermost only.
function overflowAt(page) {
  return page.evaluate((vw) => {
    const out = [];
    const docW = document.documentElement.scrollWidth;
    const clipped = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox !== 'visible') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.leaflet-container')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.right <= vw + 1 || r.left >= vw) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.position === 'fixed' || clipped(el)) continue;
      const pr = el.parentElement?.getBoundingClientRect();
      if (pr && pr.right > vw + 1 && !clipped(el.parentElement)) continue;
      const cls = String(el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.');
      out.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} +${Math.round(r.right - vw)}px "${(el.innerText || '').trim().slice(0, 40)}"`);
    }
    return { docW, out: out.slice(0, 6) };
  }, 390);
}

PROBES['overflow-sweep'] = async (browser) => {
  const { page, context } = await setup(browser, { geo: { latitude: 25.7743, longitude: -80.1937, accuracy: 20 } });
  const me = await signUp(page, 'A Very Long Display Name For Overflow Testing');
  await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-lh/accounts:update', {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: me.uid, emailVerified: true }),
  });
  const routes = ['/', '/landmarks', '/landmarks/miami/south-beach', '/landmarks/philly/independence-hall', '/mapr', '/itinerary', '/profile', '/settings', '/stats',
    '/checkins', '/mapr-ratings', '/cities', '/streaks', '/notifications', '/request-feature', '/report-bug', '/legal', '/leaderboard/full', '/add-landmark', '/feed', '/onboarding', '/no-such-page'];
  const bad = [];
  for (const r of routes) {
    await page.evaluate((x) => (location.hash = x), r);
    await page.waitForTimeout(2500);
    const o = await overflowAt(page);
    if (o.docW > 391 || o.out.length) bad.push(`${r}: page ${o.docW}px; ${o.out.join('; ')}`);
  }
  await context.close();
  return bad.length ? `FAIL\n  ${bad.join('\n  ')}` : 'PASS nothing wider than 390px';
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
