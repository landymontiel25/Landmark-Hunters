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

async function verify(uid) {
  await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-lh/accounts:update', {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, emailVerified: true }),
  });
}

// Opens the screens that start live listeners, so a sign-out or deletion
// has something to tear down.
async function warmUp(page) {
  for (const r of ['/', '/mapr', '/itinerary', '/profile', '/streaks', '/notifications', '/landmarks/miami/south-beach', '/settings']) {
    await page.evaluate((x) => (location.hash = x), r);
    await page.waitForTimeout(1800);
  }
}

const quiet = (errors) => errors.filter((e) => !/Could not reach Cloud Firestore|Failed to load resource/.test(e));

// Signing out must not leave listeners failing with permission errors.
PROBES['signout-clean'] = async (browser) => {
  const { page, context, errors } = await setup(browser, { geo: { latitude: 25.7743, longitude: -80.1937, accuracy: 20 } });
  const me = await signUp(page);
  await verify(me.uid);
  await warmUp(page);
  errors.length = 0;
  await page.getByRole('button', { name: 'Sign Out' }).first().click();
  await page.waitForTimeout(5000);
  await page.evaluate(() => (location.hash = '/'));
  await page.waitForTimeout(3000);
  await context.close();
  const e = quiet(errors);
  return e.length ? `FAIL ${e.length} errors after sign-out:\n  ${[...new Set(e.map((x) => x.slice(0, 200)))].join('\n  ')}` : 'PASS no errors after sign-out';
};

PROBES['delete-account'] = async (browser) => {
  const { page, context, errors } = await setup(browser, { geo: { latitude: 25.7743, longitude: -80.1937, accuracy: 20 } });
  const me = await signUp(page);
  await verify(me.uid);
  await warmUp(page);
  errors.length = 0;
  await page.getByRole('button', { name: 'Delete Account' }).click();
  await page.fill('input[placeholder="DELETE"]', 'DELETE');
  await page.fill('#delete-password', 'simpass123');
  await page.getByRole('button', { name: 'Delete My Account' }).click();
  await page.waitForTimeout(8000);
  const where = await page.evaluate(() => location.hash);
  const stillThere = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: me.email, password: 'simpass123', returnSecureToken: true }),
  }).then((r) => r.ok);
  await context.close();
  const e = quiet(errors);
  if (stillThere) return `FAIL account still exists (screen ${where}); errors: ${e.slice(0, 3).join(' | ')}`;
  return e.length ? `FAIL account deleted but ${e.length} errors:\n  ${[...new Set(e.map((x) => x.slice(0, 200)))].join('\n  ')}` : `PASS deleted, no errors (now on ${where})`;
};

// A group trip with a friend: open it, share live location, start the
// trip, then the owner deletes it while the friend is looking at it.
PROBES['group-trip'] = async (browser) => {
  const { page, context, errors } = await setup(browser, { geo: { latitude: 25.7743, longitude: -80.1937, accuracy: 20 } });
  const me = await signUp(page, 'Group Member');
  await verify(me.uid);
  const owner = `probeOwner${Date.now()}`;
  const tripId = `probeTrip${Date.now()}`;
  await adminSet(`users/${owner}`, { displayName: 'Trip Owner', username: `owner${Date.now() % 100000}` });
  await adminSet(`friend_edges/${owner}_${me.uid}`, { owner, friend: me.uid, friendName: 'Group Member', createdAt: new Date() });
  await adminSet(`friend_edges/${me.uid}_${owner}`, { owner: me.uid, friend: owner, friendName: 'Trip Owner', createdAt: new Date() });
  await adminSet(`group_trips/${tripId}`, {
    ownerUid: owner,
    name: 'Probe Weekend',
    regionId: 'miami',
    memberUids: [owner, me.uid],
    memberNames: { [owner]: 'Trip Owner', [me.uid]: 'Group Member' },
    landmarkIds: ['south-beach', 'ocean-drive'],
    places: [],
    createdAt: new Date(),
  });
  await page.evaluate((id) => (location.hash = `/group/${id}`), tripId);
  await page.waitForTimeout(3500);
  const steps = [];
  const tapText = async (re) => {
    const el = page.getByRole('button', { name: re }).first();
    if (await el.count()) {
      await el.tap().catch(() => {});
      steps.push(String(re));
      await page.waitForTimeout(1200);
    }
  };
  await tapText(/Share live location/);
  await tapText(/15 minutes/);
  await tapText(/View in Map|Start Trip/);
  await page.goBack();
  await page.waitForTimeout(2000);
  // The owner deletes the trip while this member has it open.
  await fetch(`http://127.0.0.1:8080/v1/projects/demo-lh/databases/(default)/documents/group_trips/${tripId}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  await page.waitForTimeout(4000);
  const text = await page.evaluate(() => document.querySelector('main')?.innerText.slice(0, 200) || '');
  const boundary = /Something went wrong/.test(text);
  await context.close();
  const e = quiet(errors);
  if (boundary) return `FAIL error screen after the trip was deleted: ${text}`;
  return e.length ? `FAIL ${e.length} errors (${steps.join(', ')}):\n  ${[...new Set(e.map((x) => x.slice(0, 220)))].join('\n  ')}` : `PASS (${steps.join(', ')}); after delete: "${text.replace(/\s+/g, ' ').slice(0, 100)}"`;
};

// The Map's floating controls (search, +, filter, radius menu, locate)
// must not cover each other with the Picked for you sheet open, on a
// 390x844 phone and on Safari's shorter visible area (390x664).
PROBES['map-controls'] = async (browser) => {
  const { page, context } = await setup(browser, { geo: { latitude: 25.7743, longitude: -80.1937, accuracy: 20 } });
  const me = await signUp(page);
  await verify(me.uid);
  await page.waitForTimeout(5000);
  const bad = [];
  const seen = [];
  for (const h of [844, 664]) {
    await page.setViewportSize({ width: 390, height: h });
    await page.evaluate(() => (location.hash = '/'));
    await page.waitForTimeout(4000);
    await page.locator('.map-fullscreen.has-picks').waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    // Any two controls whose boxes overlap: one sits on part of the other.
    const covered = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.map-search-btn, .radius-select, .map-locate-btn, .map-picks .mpp-sheet')].filter((e) => e.getBoundingClientRect().width);
      const out = [];
      for (let i = 0; i < els.length; i += 1) {
        for (let j = i + 1; j < els.length; j += 1) {
          const a = els[i].getBoundingClientRect();
          const b = els[j].getBoundingClientRect();
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          const nm = (e) => e.getAttribute('aria-label') || e.className.split(' ')[0];
          if (w > 0 && h > 0) out.push(`${nm(els[i])} and ${nm(els[j])} overlap ${Math.round(w)}x${Math.round(h)}px`);
        }
      }
      return out;
    });
    const sheet = await page.locator('.map-fullscreen.has-picks').count();
    seen.push(`390x${h} sheet ${sheet ? 'open' : 'closed'}`);
    if (covered.length) bad.push(`390x${h}${sheet ? ' (sheet open)' : ''}: ${covered.join('; ')}`);
  }
  await context.close();
  return bad.length ? `FAIL ${bad.join(' | ')}` : `PASS no map control covered (${seen.join(', ')})`;
};

// Check in at a place with a rating, a comment and a photo (Storage
// emulator), the full Post path.
PROBES['checkin-photo'] = async (browser) => {
  const geo = { latitude: 25.774429, longitude: -80.133241, accuracy: 10 };
  const { page, context, errors } = await setup(browser, { geo });
  const me = await signUp(page);
  await verify(me.uid);
  await page.waitForTimeout(3000);
  // A small real JPEG, drawn by the browser.
  const jpeg = Buffer.from(
    (await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 48;
      const g = c.getContext('2d');
      g.fillStyle = '#3a7';
      g.fillRect(0, 0, 64, 48);
      return c.toDataURL('image/jpeg', 0.8);
    })).split(',')[1],
    'base64'
  );
  let chooser = 0;
  page.on('filechooser', (fc) => {
    chooser += 1;
    fc.setFiles({ name: 'beach.jpg', mimeType: 'image/jpeg', buffer: jpeg }).catch(() => {});
  });
  await page.evaluate(() => (location.hash = '/landmarks/miami/south-beach'));
  await page.waitForTimeout(3000);
  const steps = [];
  const tap = async (re, where = page) => {
    const el = where.getByRole('button', { name: re }).first();
    if (!(await el.count())) return false;
    await el.tap({ timeout: 4000 }).catch(() => {});
    steps.push(String(re));
    await page.waitForTimeout(1200);
    return true;
  };
  if (!(await tap(/Check In/))) return 'FAIL no Check In button';
  const sheet = page.locator('.modal-card').first();
  await tap(/loved it/i, sheet);
  const comment = page.locator('textarea').first();
  if (await comment.count()) await comment.fill('Great sunset walk, busy on weekends.');
  await tap(/Add photo/, sheet);
  await page.waitForTimeout(2500);
  const inputs = await page.evaluate(() => [...document.querySelectorAll('input[type=file]')].map((i) => `${i.accept}|${i.isConnected}`));
  steps.push(`file inputs: ${JSON.stringify(inputs)}`);
  if (process.env.PROBE_SHOTS) await page.screenshot({ path: `${process.env.PROBE_SHOTS}/checkin-photo.png` });
  const thumbs = await page.locator('.modal-card img').count();
  await tap(/^Post$|Confirm check-in/, sheet);
  await page.waitForTimeout(9000);
  const text = await page.evaluate(() => document.body.innerText.slice(0, 4000));
  const posted = /checked in|Posted|points|\+\d+ pts|Nice/i.test(text);
  // The new check-in on My Check-ins opens its landmark page when tapped.
  await tap(/^Done$/, sheet);
  await page.evaluate(() => (location.hash = '/checkins'));
  await page.waitForTimeout(3500);
  const tile = page.locator('.checkin-tile, .checkin-row').first();
  if (process.env.PROBE_DEBUG) {
    console.log(await page.evaluate(() => [...document.querySelectorAll('.checkin-tile, .checkin-row')].map((e) => `${e.className}|${e.innerText.slice(0, 60)}`).join('\n')));
    await page.screenshot({ path: `${process.env.PROBE_DEBUG}/checkins.png` });
  }
  let opened = 'no tile';
  if (await tile.count()) {
    await tile.tap().catch(() => {});
    await page.waitForTimeout(1500);
    opened = page.url().includes('/landmarks/miami/south-beach') ? 'tile opens the place' : `tile left us on ${page.url().split('#')[1]}`;
  }
  steps.push(opened);
  const list = await fetch('http://127.0.0.1:9199/v0/b/demo-lh.appspot.com/o', { headers: { Authorization: 'Bearer owner' } })
    .then((r) => r.json())
    .catch(() => ({}));
  const mine = (list.items || []).filter((o) => String(o.name).includes(me.uid));
  await context.close();
  const e = quiet(errors);
  const summary = `steps ${steps.join(', ')}; file chooser opened ${chooser}x; preview images ${thumbs}; posted=${posted}; photos in Storage for this user: ${mine.length}`;
  if (e.length) return `FAIL ${summary}; errors:\n  ${[...new Set(e.map((x) => x.slice(0, 220)))].join('\n  ')}`;
  return posted && mine.length && opened === 'tile opens the place' ? `PASS ${summary}` : `FAIL ${summary}`;
};

// Offline on the Map: the offline banner must be visible (not under the
// map) and the header, the onboarding banner and the map buttons must not
// sit on each other.
PROBES['offline-map'] = async (browser) => {
  const { page, context } = await setup(browser, { geo: { latitude: 25.7743, longitude: -80.1937, accuracy: 20 } });
  const me = await signUp(page);
  await verify(me.uid);
  await page.waitForTimeout(4000);
  await page.evaluate(() => (location.hash = '/'));
  await page.waitForTimeout(3000);
  await context.setOffline(true);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const vis = (el) => {
      if (!el) return 'missing';
      const b = el.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return top && (top === el || el.contains(top)) ? 'visible' : `covered by ${top?.className || top?.tagName}`;
    };
    const boxes = [...document.querySelectorAll('header.app-header, .onboarding-banner-fixed, .map-search-btn, .map-picks .mpp-sheet')].map((e) => [e.className.split(' ')[0], e.getBoundingClientRect()]);
    const overlaps = [];
    for (let i = 0; i < boxes.length; i += 1)
      for (let j = i + 1; j < boxes.length; j += 1) {
        const [na, a] = boxes[i];
        const [nb, b] = boxes[j];
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 0 && h > 0) overlaps.push(`${na}/${nb} ${Math.round(w)}x${Math.round(h)}`);
      }
    return { banner: vis(document.querySelector('[role=status].offline-banner') || [...document.querySelectorAll('[role=status]')].find((e) => /offline/i.test(e.textContent))), overlaps };
  });
  await context.setOffline(false);
  await context.close();
  const ok = r.banner === 'visible' && !r.overlaps.length;
  return `${ok ? 'PASS' : 'FAIL'} offline banner ${r.banner}; overlaps: ${r.overlaps.join(', ') || 'none'}`;
};

// A tip from another visitor with a long pasted link, on a landmark page.
PROBES['tips-long'] = async (browser) => {
  const { page, context } = await setup(browser);
  // Alternating draws: the tips stub then returns one tip with a long link.
  let k = 0;
  context.__simRouter = makeRouter({ rng: () => (k++ % 2 ? 0.2 : 0.6), base: BASE, stats: { api: {}, unknownApi: {}, external: {}, requests: 0 }, failRate: 0 });
  const me = await signUp(page);
  await verify(me.uid);
  await page.waitForTimeout(3000);
  await page.evaluate(() => (location.hash = '/landmarks/miami/south-beach'));
  await page.waitForTimeout(5000);
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(1500);
  const shown = await page.evaluate(() => document.body.innerText.includes('example.com/ppp'));
  const o = await overflowAt(page);
  await context.close();
  if (!shown) return 'FAIL the stub tip did not show (probe setup)';
  return o.docW > 391 || o.out.length ? `FAIL page ${o.docW}px; ${o.out.join('; ')}` : 'PASS a long tip wraps';
};

// A landmark link opened fresh (as from a text message): Back stays in the
// app and lands on Places.
PROBES['shared-link-back'] = async (browser) => {
  const { page, context } = await setup(browser);
  await page.goto(`${BASE}/#/landmarks/miami/south-beach`);
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: /← Back/ }).first().tap();
  await page.waitForTimeout(1500);
  const url = page.url();
  await context.close();
  return url.startsWith(BASE) && /#\/landmarks$/.test(url) ? 'PASS Back went to Places' : `FAIL Back went to ${url}`;
};

// Feature request and bug report forms: fill, send, see it confirmed.
PROBES['forms'] = async (browser) => {
  const { page, context, errors } = await setup(browser);
  const me = await signUp(page);
  await verify(me.uid);
  await page.waitForTimeout(3000);
  const out = [];
  for (const [route, fields] of [
    ['/request-feature', [['Dark mode', 'A one-tap day plan'], ['What should it do', 'Plan my afternoon around where I am.'], ['What problem', 'Saves time on a trip.']]],
    ['/report-bug', [["Map pins don't load", 'Filter button hidden'], ['What did you see', 'The filter button sits under the sheet.'], ['What did you tap', 'Open the Map on a small phone.']]],
  ]) {
    await page.evaluate((x) => (location.hash = x), route);
    await page.waitForTimeout(2500);
    for (const [ph, v] of fields) await page.getByPlaceholder(new RegExp(ph)).first().fill(v);
    await page.locator('form button[type=submit]').first().tap();
    await page.waitForTimeout(3500);
    const text = await page.evaluate(() => document.querySelector('main')?.innerText || '');
    out.push(`${route}: ${/thank|sent|got it|received|submitted/i.test(text) ? 'confirmed' : `no confirmation ("${text.replace(/\s+/g, ' ').slice(0, 80)}")`}`);
  }
  await context.close();
  const e = quiet(errors);
  const ok = out.every((x) => x.endsWith('confirmed')) && !e.length;
  return `${ok ? 'PASS' : 'FAIL'} ${out.join('; ')}${e.length ? `; errors: ${e.slice(0, 3).join(' | ')}` : ''}`;
};

// Long unbroken text people type (a pasted link, a key held down) must
// wrap, not widen the screen: a Mapr message and a check-in comment.
PROBES['long-text'] = async (browser) => {
  const geo = { latitude: 25.774429, longitude: -80.133241, accuracy: 10 };
  const { page, context } = await setup(browser, { geo });
  const me = await signUp(page);
  await verify(me.uid);
  await page.waitForTimeout(3000);
  const long = `https://example.com/${'a'.repeat(180)}`;
  const bad = [];
  await page.evaluate(() => (location.hash = '/mapr'));
  await page.waitForTimeout(3000);
  await page.getByPlaceholder(/up for/).first().fill(long);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  let o = await overflowAt(page);
  if (o.docW > 391 || o.out.length) bad.push(`/mapr: page ${o.docW}px; ${o.out.join('; ')}`);
  // The chat is named after that first message; open the chat list.
  await page.getByRole('button', { name: 'Your chats' }).first().tap().catch(() => {});
  await page.waitForTimeout(1500);
  o = await overflowAt(page);
  if (o.docW > 391 || o.out.length) bad.push(`/mapr chat list: page ${o.docW}px; ${o.out.join('; ')}`);
  await page.keyboard.press('Escape');
  await page.evaluate(() => (location.hash = '/landmarks/miami/south-beach'));
  await page.waitForTimeout(3000);
  const sheet = page.locator('.modal-card').first();
  await page.getByRole('button', { name: /Check In/ }).first().tap();
  await page.waitForTimeout(1500);
  await sheet.getByRole('button', { name: /loved it/i }).first().tap();
  await page.waitForTimeout(800);
  const ta = sheet.locator('textarea').first();
  if (await ta.count()) await ta.fill(long);
  await sheet.getByRole('button', { name: /^Post$|Confirm check-in/ }).first().tap();
  await page.waitForTimeout(6000);
  await page.keyboard.press('Escape');
  await page.evaluate(() => (location.hash = '/'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => (location.hash = '/landmarks/miami/south-beach'));
  await page.waitForTimeout(4000);
  o = await overflowAt(page);
  if (o.docW > 391 || o.out.length) bad.push(`landmark page: page ${o.docW}px; ${o.out.join('; ')}`);
  for (const r of ['/checkins', '/stats', '/mapr-ratings']) {
    await page.evaluate((x) => (location.hash = x), r);
    await page.waitForTimeout(3000);
    o = await overflowAt(page);
    if (o.docW > 391 || o.out.length) bad.push(`${r}: page ${o.docW}px; ${o.out.join('; ')}`);
  }
  await context.close();
  return bad.length ? `FAIL\n  ${bad.join('\n  ')}` : 'PASS long text wraps everywhere checked';
};

const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
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
