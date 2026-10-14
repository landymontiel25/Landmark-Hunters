// One simulated user session: a persona, a seeded RNG, and 20-60 actions
// across the whole app. Findings (errors, crash screens, stuck spinners,
// overflow, dead buttons) go into `out.findings` with the action index, so a
// report can replay the steps.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRouter, CATALOG, adminSet } from './stubs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// A 48x32 JPEG (drawn by Chromium) for photo pickers.
const SMALL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAgADADASIAAhEBAxEB/8QAGQABAQEAAwAAAAAAAAAAAAAAAAYFAwQH/8QAKxAAAQIEBAILAAAAAAAAAAAAAAERAgMEBQYSExQWoyIxNUFUYWSCstHi/8QAFwEAAwEAAAAAAAAAAAAAAAAAAgMFBP/EACMRAAAGAQMFAQAAAAAAAAAAAAABAgMEERIFEyExUWFxgcH/2gAMAwEAAhEDEQA/AOI0+Hbr4XmQ/ZmHpREny1x8cCLm+vwRNMgty88zMqrp5vwIOos1wpJEU+fT5JcLOueFWdW7lOiW+Iuw6j2/JCIGwZCpDZqV3rj4E6jFRFdJCDOqvn2YAA2icBS8Yeg535JoCHo7T1bhXQ0sS3o97R1fr9G5ccSb+hmUu0087dLUdmVF6m8jDACaZbZTigqIC/IdkKycOzAADQgf/9k=',
  'base64'
);
const INPAGE = readFileSync(join(here, 'inpage.js'), 'utf8');

// A browser context for one worker and device type. Sessions swap their
// own network stub in through context.__simRouter.
export async function newSimContext(browser, device) {
  const phone = device === 'phone';
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 900 },
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    timezoneId: phone ? 'America/New_York' : 'America/Los_Angeles',
  });
  context.setDefaultTimeout(4000);
  context.setDefaultNavigationTimeout(15000);
  await context.addInitScript(INPAGE);
  await context.route('**/*', (route) => (context.__simRouter ? context.__simRouter(route) : route.continue().catch(() => {})));
  // Links that open a new tab: close it, the user stays in the app.
  context.on('page', (p) => {
    if (!context.__simOpening && context.__simPage && p !== context.__simPage) p.close().catch(() => {});
  });
  return context;
}

// ---------- seeded randomness ----------
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0) || 1;
}
export function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
function weighted(rng, entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = rng() * total;
  for (const [v, w] of entries) {
    x -= w;
    if (x <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

// ---------- personas ----------
const CITIES = [
  { name: 'Miami', lat: 25.7743, lng: -80.1937, region: 'miami' },
  { name: 'Miami Beach', lat: 25.7907, lng: -80.13, region: 'miami' },
  { name: 'Philadelphia', lat: 39.9526, lng: -75.1652, region: 'philly' },
  { name: 'Villanova', lat: 40.0377, lng: -75.3421, region: 'villanova' },
  { name: 'San Francisco', lat: 37.7749, lng: -122.4194, region: 'san-francisco' },
  { name: 'Palo Alto', lat: 37.4419, lng: -122.143, region: 'silicon-valley' },
  { name: 'New York', lat: 40.758, lng: -73.9855, region: 'nyc' },
  { name: 'Madrid', lat: 40.4168, lng: -3.7038, region: 'madrid' },
  { name: 'Wichita (no city nearby)', lat: 37.6872, lng: -97.3301, region: null },
];

export const PERSONAS = [
  ['newUser', 30],
  ['returning', 28],
  ['groupTrip', 12],
  ['guest', 18],
  ['chaos', 7],
  ['desktopPlanner', 5],
];

export function makePersona(rng, kind) {
  const city = pick(rng, CITIES);
  const desktop = kind === 'desktopPlanner' || rng() < 0.04;
  return {
    kind,
    city: city.name,
    region: city.region,
    coords: { latitude: city.lat + (rng() - 0.5) * 0.04, longitude: city.lng + (rng() - 0.5) * 0.04, accuracy: 10 + Math.floor(rng() * 60) },
    location: rng() < 0.7 ? 'on' : 'off',
    viewport: desktop ? { width: 1366, height: 900 } : { width: 390, height: 844 },
    flakyNetwork: kind === 'chaos' || rng() < 0.12,
    // 20-60, most sessions short (mean about 33), as real use skews.
    actions: 20 + Math.floor(rng() * rng() * 41),
  };
}

// ---------- text the personas type ----------
const SEARCHES = ['pizza', 'museum', 'South Beach', 'Liberty Bell', 'coffee', 'park', 'tacos', 'Golden Gate', 'rooftop bar', 'art', 'brunch', 'Wynwood', 'beach', 'kids', 'free', '日本', 'café', 'x', '', '   ', 'zzzzzzzzqqq', "O'Malley's", '<b>bold</b>', 'a'.repeat(300), '🍕'];
const CHAT = [
  'What should I do this afternoon?',
  'Find me a quiet coffee shop near me',
  'Plan my whole day in Miami',
  'Something new I have never tried',
  'Where can I take my kids?',
  'rate a place',
  'Add the first one to my itinerary',
  'Best tacos open late?',
  'hi',
  'How far is the nearest museum?',
  'Make a plan for my group trip this weekend',
  'thanks',
  'What is Landmark Hunters?',
  '',
  'a'.repeat(1200),
];
const FREE_TEXT = ['Great spot', 'Loved the view!', 'Too crowded on weekends', 'Sim test', '🌴🌴🌴', 'x'.repeat(600), 'Weekend in Philly', 'Group trip', 'Mom & Dad'];

function textFor(rng, meta) {
  const hint = `${meta.placeholder} ${meta.label} ${meta.name} ${meta.type}`.toLowerCase();
  if (meta.type === 'email' || /email/.test(hint)) return `sim${Math.floor(rng() * 1e6)}@example.com`;
  if (meta.type === 'password' || /password/.test(hint)) return pick(rng, ['simpass123', '12', 'correct horse battery']);
  if (meta.type === 'number') return String(Math.floor(rng() * 100));
  if (meta.type === 'date') return '2026-11-0' + (1 + Math.floor(rng() * 8));
  if (meta.type === 'time') return '1' + Math.floor(rng() * 9) + ':30';
  if (/up for|ask mapr|message|chat/.test(hint)) return pick(rng, CHAT);
  if (/search|find|city|region|address|where/.test(hint)) return pick(rng, SEARCHES);
  if (/name|title/.test(hint)) return pick(rng, ['My Trip', 'Sim Explorer', 'Weekend 🌴', '', 'a'.repeat(120)]);
  if (/username|@/.test(hint)) return pick(rng, ['simfriend', 'nobody_here', 'a']);
  return pick(rng, FREE_TEXT);
}

// ---------- page helpers ----------
const ROUTES = [
  '/', '/landmarks', '/mapr', '/itinerary', '/profile', '/settings', '/stats', '/checkins', '/mapr-ratings', '/cities', '/streaks',
  '/notifications', '/request-feature', '/report-bug', '/onboarding', '/test', '/test/onboarding', '/legal', '/leaderboard',
  '/leaderboard/full', '/leaderboard/full?period=monthly', '/account', '/feed', '/add-landmark', '/group/doesNotExist123',
  '/friend/nobody123/checkins', '/friend/nobody123/cities', '/no-such-page', '/landmarks/miami/not-a-real-id', '/landmarks/nowhere/x',
];
function randomLandmarkRoute(rng, region) {
  const pool = region ? CATALOG.filter((p) => p.region === region) : CATALOG;
  const p = pick(rng, pool.length ? pool : CATALOG);
  return { route: `/landmarks/${p.region}/${p.id}`, place: p };
}

// Visible, uncovered, enabled clickables, tagged with data-sim-id.
async function clickables(page, { scope = 'main', includeNav = false } = {}) {
  return page.evaluate(
    ({ scope, includeNav }) => {
      const vw = innerWidth;
      const vh = innerHeight;
      const SEL = 'button, a[href], [role=button], [role=tab], [role=link], [role=switch], [role=checkbox], summary, input[type=checkbox], input[type=radio], label';
      const modal = [...document.querySelectorAll('.modal-backdrop, [role=dialog], .sheet-backdrop, .bottom-sheet')].filter((m) => {
        const r = m.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).pop();
      const root = modal || (scope === 'all' ? document.body : document.body);
      const out = [];
      let n = 0;
      // Plus any element React gave an onClick (tiles, rows, cards): React
      // keeps an element's props on it under __reactProps$<id>.
      const reactClickable = (el) => {
        for (const k in el) {
          if (!k.startsWith('__reactProps$')) continue;
          const f = el[k]?.onClick;
          if (typeof f !== 'function' || el.matches(SEL)) return false;
          // A sheet's own "don't close me" handler is not a control.
          const src = String(f);
          return !(src.length < 90 && /stopPropagation/.test(src));
        }
        return false;
      };
      const candidates = [...root.querySelectorAll(SEL)];
      for (const el of root.querySelectorAll('div, span, li, img, p, section, article, td, tr, h2, h3, h4')) {
        if (el.closest('.leaflet-container') || el.closest('.bottom-nav')) continue;
        if (reactClickable(el) && !/backdrop|overlay/.test(String(el.className))) candidates.push(el);
        if (candidates.length > 1500) break;
      }
      for (const el of candidates) {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        const inNav = !!el.closest('.bottom-nav');
        if (inNav && !includeNav) continue;
        const href = el.getAttribute('href') || '';
        if (/^(https?:|mailto:|tel:|sms:)/.test(href) && !href.startsWith(location.origin)) continue;
        if (el.getAttribute('target') === '_blank') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        // In or near the viewport (lists scroll), not far below.
        if (r.bottom < -200 || r.top > vh * 3 || r.right < 0 || r.left > vw) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || Number(cs.opacity) < 0.05) continue;
        // On-screen ones must not be covered by something else.
        if (r.top >= 0 && r.bottom <= vh) {
          const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
          const y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
          const top = document.elementFromPoint(x, y);
          if (top && top !== el && !el.contains(top) && !top.contains(el) && !(el.tagName === 'LABEL' && el.control === top)) continue;
        }
        const id = `s${Date.now().toString(36)}${n++}`;
        el.setAttribute('data-sim-id', id);
        const label = (el.getAttribute('aria-label') || el.innerText || el.title || el.value || el.className || el.tagName).toString().trim().replace(/\s+/g, ' ').slice(0, 60);
        out.push({
          id,
          tag: el.tagName,
          label,
          inNav,
          inModal: !!modal,
          primary: /btn-primary/.test(el.className || ''),
          pressed: el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true' || /\b(active|selected|on)\b/.test(String(el.className || '')),
          marker: !!el.closest('.leaflet-container'),
          isInput: el.tagName === 'INPUT' || el.tagName === 'LABEL',
          // A submit button whose form fails validation shows the browser's
          // own bubble, which changes no DOM: not a dead button.
          invalidForm: !!(el.form && el.type === 'submit' && !el.form.checkValidity()),
        });
        if (out.length > 400) break;
      }
      return out;
    },
    { scope, includeNav }
  );
}

async function fillables(page) {
  return page.evaluate(() => {
    const out = [];
    let n = 0;
    const modal = [...document.querySelectorAll('.modal-backdrop, [role=dialog]')].filter((m) => m.getBoundingClientRect().width > 0).pop();
    for (const el of (modal || document).querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]):not([type=range]), textarea, select')) {
      if (el.disabled || el.readOnly) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.top > innerHeight * 2) continue;
      const id = `f${Date.now().toString(36)}${n++}`;
      el.setAttribute('data-sim-id', id);
      const lab = el.id && document.querySelector(`label[for="${el.id}"]`);
      out.push({
        id,
        tag: el.tagName,
        type: (el.getAttribute('type') || '').toLowerCase(),
        placeholder: el.getAttribute('placeholder') || '',
        label: el.getAttribute('aria-label') || lab?.textContent || '',
        name: el.getAttribute('name') || el.id || '',
        options: el.tagName === 'SELECT' ? [...el.options].filter((o) => !o.disabled).map((o) => o.value) : [],
      });
    }
    return out;
  });
}

// The account's uid, from the auth emulator (the same sign-in the app does).
async function lookupUid(email, password) {
  try {
    const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    if (!r.ok) return null;
    return (await r.json()).localId || null;
  } catch {
    return null;
  }
}

const DANGER = /with Google|delete (my )?account|delete everything|delete all|erase|reset onboarding|remove all/i;
const RARE = /sign out|log out|leave (trip|group)|delete|remove|block|unfriend|report/i;

// ---------- the session ----------
export async function runSession({ getContext, base, index, seed, persona: forcedPersona, pool, out, opts }) {
  const rng = mulberry32(hashSeed(`${seed}:${index}`));
  const kind = forcedPersona || weighted(rng, PERSONAS);
  const persona = makePersona(rng, kind);
  const steps = [];
  const findings = [];
  const stats = { api: {}, unknownApi: {}, external: {}, requests: 0 };
  const startedAt = Date.now();
  let actionNo = 0;
  let offline = false;
  let account = null;

  // Contexts are reused across sessions (one per worker and device type) so
  // the browser's HTTP and code caches stay warm; everything a user leaves
  // behind (storage, permissions, location, network state) is reset here.
  const device = persona.viewport.width < 500 ? 'phone' : 'desktop';
  const context = await getContext(device);
  context.__simRouter = makeRouter({ rng: mulberry32(hashSeed(`${seed}:${index}:net`)), base, stats, failRate: opts.failRate });
  await context.setOffline(false);
  await context.clearCookies();
  await context.clearPermissions();
  await context.grantPermissions(persona.location === 'on' ? ['geolocation', 'clipboard-read', 'clipboard-write'] : ['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  await context.setGeolocation(persona.location === 'on' ? persona.coords : null);
  context.__simOpening = true;
  const page = await context.newPage();
  context.__simPage = page;
  context.__simOpening = false;
  await page.goto(`${base}/__sim_reset`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title === 'reset-done', null, { timeout: 10000 });

  const shotKinds = new Set();
  const add = (kindName, message, extra = {}) => {
    findings.push({ kind: kindName, message: String(message).slice(0, 600), action: actionNo, hash: safeHash(), ...extra });
    // --shots: one screenshot per kind per session, for the report.
    if (opts.shotsDir && !shotKinds.has(kindName) && !['harness', 'infra', 'console', 'console-warning'].includes(kindName)) {
      shotKinds.add(kindName);
      page.screenshot({ path: join(opts.shotsDir, `${index}-${actionNo}-${kindName}.png` ) }).catch(() => {});
    }
  };
  let lastUrl = base;
  const safeHash = () => {
    try {
      lastUrl = page.url();
    } catch {
      /* closed */
    }
    if (lastUrl.startsWith('chrome-error:')) return '#chrome-error';
    return new URL(lastUrl).hash || '#/';
  };

  page.on('pageerror', (e) => add('pageerror', e.message, { stack: (e.stack || '').split('\n').slice(0, 6).join('\n') }));
  page.on('console', (m) => {
    if (m.type() !== 'error' && !(m.type() === 'warning' && /Uncaught|permission|insufficient/i.test(m.text()))) return;
    const t = m.text();
    if (/chrome-error:\/\//.test(t)) return;
    // Our own stubs answer fonts with 404 and some AI calls with 503 on purpose.
    // (Other failed loads are recorded with their URL by the response handler.)
    if (/Failed to load resource: the server responded with a status of/.test(t)) return;
    if (offline && /ERR_INTERNET_DISCONNECTED|Failed to fetch|network|offline|Could not reach Cloud Firestore/i.test(t)) return;
    // The emulator on a loaded machine, not the app.
    if (/Could not reach Cloud Firestore backend/.test(t)) return add('infra', t.replace(/^\[[^\]]+\]\s*/, ''));
    add(m.type() === 'error' ? 'console' : 'console-warning', t, { loc: m.location()?.url ? `${m.location().url.split('/').pop()}:${m.location().lineNumber}` : '' });
  });
  page.on('request', () => {
    stats.requests += 1;
  });
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText || '';
    if (/ERR_ABORTED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(f) || offline) return;
    add('requestfailed', `${r.method()} ${r.url().replace(/\?.*/, '')} ${f}`);
  });
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/')) return;
    if (r.status() >= 500) add('http5xx', `${r.status()} ${r.request().method()} ${u.replace(/\?.*/, '')}`);
    else if (r.status() >= 400 && u.startsWith(base)) add('http4xx', `${r.status()} ${r.request().method()} ${u.replace(/\?.*/, '')}`);
    // Firestore and Storage errors. Auth's 400s are wrong passwords and
    // taken emails (the sign-in form shows them), not app faults.
    else if (r.status() >= 400 && /127\.0\.0\.1:(8080|9199)/.test(u)) {
      const path = u.replace(/\?.*/, '').replace(/\/v1\/projects\/demo-lh\/databases\/\(default\)\/documents/, '');
      r.text()
        .then((t) => {
          // A transaction that lost a race; the SDK retries it.
          if (/does not match the required base version|entity already exists/.test(t)) return;
          add('http4xx', `${r.status()} ${r.request().method()} ${path} ${t.slice(0, 200)}`);
        })
        .catch(() => add('http4xx', `${r.status()} ${r.request().method()} ${path}`));
    }
  });
  // Photo pickers (check-in, tips, add landmark) get a small JPEG most of
  // the time, and are cancelled otherwise.
  page.on('filechooser', (fc) => {
    if (rng() < 0.8) {
      steps.push('  (picks a photo)');
      fc.setFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: SMALL_JPEG }).catch(() => {});
    } else steps.push('  (cancels the photo picker)');
  });
  page.on('dialog', (d) => {
    steps.push(`  dialog(${d.type()}): ${d.message().slice(0, 80)}`);
    (rng() < 0.7 ? d.accept(d.type() === 'prompt' ? 'Sim answer' : undefined) : d.dismiss()).catch(() => {});
  });

  const step = (s) => steps.push(`${actionNo}. ${s}`);
  const settle = (ms = 300) => page.waitForTimeout(ms);
  // In-app moves change the hash, the way a tapped link does; a fresh
  // page load (opening a shared link) only happens online.
  let loaded = false;
  const goto = async (route, { fresh = false } = {}) => {
    // A reload while offline (the error screen's Try Again does one) leaves
    // the browser's own error page; the next move is a real page load.
    if (page.url().startsWith('chrome-error:')) {
      loaded = false;
      if (offline) {
        offline = false;
        step('  (back online to leave the browser error page)');
        await context.setOffline(false).catch(() => {});
      }
    }
    if (loaded && (!fresh || offline)) {
      await page.evaluate((r) => {
        location.hash = r;
      }, route).catch((e) => add('harness', `hash ${route}: ${e.message.split('\n')[0]}`));
      return settle(500);
    }
    // The first load replaces the reset page, so Back from the first screen
    // leaves the app instead of landing on the harness's blank page.
    const nav = page.url().includes('/__sim_reset')
      ? Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
          page.evaluate((u) => location.replace(u), `${base}/#${route}`),
        ])
      : page.goto(`${base}/#${route}`, { waitUntil: 'domcontentloaded' });
    await nav.then(() => {
      loaded = true;
    }).catch((e) => add('harness', `goto ${route}: ${e.message.split('\n')[0]}`));
    return settle(900);
  };

  // Clicks one tagged element and reports it when nothing at all happened.
  const clickEl = async (c, { dbl = false } = {}) => {
    const before = await page.evaluate(() => ({ mut: window.__sim?.mut || 0, href: location.href, opened: window.__sim?.opened.length || 0, shared: window.__sim?.shared || 0 })).catch(() => null);
    const reqBefore = stats.requests;
    const loc = page.locator(`[data-sim-id="${c.id}"]`);
    try {
      // Phones tap (touch events, then the browser's own mouse events), as
      // real fingers do; desktops click.
      if (device === 'phone') {
        await loc.tap({ timeout: 2500 });
        if (dbl) await loc.tap({ timeout: 1000 }).catch(() => {});
      } else if (dbl) {
        await loc.click({ timeout: 2500, clickCount: 2, delay: 30 });
      } else {
        await loc.click({ timeout: 2500 });
      }
    } catch (e) {
      // Usually the element moved or vanished between listing and click.
      return false;
    }
    await settle(450);
    if (!before || c.isInput || c.invalidForm || c.pressed || c.marker || c.inNav || c.tag === 'A') return true;
    const after = await page.evaluate(() => ({ mut: window.__sim?.mut || 0, href: location.href, opened: window.__sim?.opened.length || 0, shared: window.__sim?.shared || 0 })).catch(() => null);
    if (after && after.mut === before.mut && after.href === before.href && after.opened === before.opened && after.shared === before.shared && stats.requests === reqBefore) {
      add('noop', `Button did nothing: "${c.label}"`, { label: c.label });
    }
    return true;
  };

  const clickMatching = async (re, opts2 = {}) => {
    const list = (await clickables(page, opts2).catch(() => [])).filter((c) => re.test(c.label));
    if (!list.length) return false;
    const c = pick(rng, list);
    step(`click "${c.label}"`);
    return clickEl(c);
  };

  const fillMatching = async (re, value) => {
    const list = (await fillables(page).catch(() => [])).filter((f) => re.test(`${f.placeholder} ${f.label} ${f.name}`));
    if (!list.length) return false;
    const f = list[0];
    step(`type "${String(value).slice(0, 40)}" into "${f.placeholder || f.label || f.name}"`);
    await page.locator(`[data-sim-id="${f.id}"]`).fill(value, { timeout: 2500 }).catch(() => {});
    return true;
  };

  // ---------- sign up / sign in ----------
  const signUp = async () => {
    await goto('/profile');
    if (!(await clickMatching(/Create an Account/i))) return false;
    const email = `sim-${seed}-${index}-${Math.floor(rng() * 1e6)}@example.com`.toLowerCase();
    const password = 'simpass123';
    const name = pick(rng, ['Ana', 'Ben', 'Carla', 'Dev', 'Eli', 'Fatima', 'Gus', 'Hana']) + ' ' + pick(rng, ['Lopez', 'Kim', 'Smith', 'Patel', 'Nguyen']);
    step(`sign up as ${email}`);
    await page.fill('#name', name).catch(() => {});
    await page.fill('#email', email).catch(() => {});
    await page.fill('#password', password).catch(() => {});
    if (rng() < 0.95) await page.check('input[name="age-confirmed"]').catch(() => {});
    await page.click('form button[type=submit]').catch(() => {});
    await page.waitForFunction(() => !location.hash.startsWith('#/profile') || !document.querySelector('#password'), null, { timeout: 8000 }).catch(() => {});
    await settle(800);
    account = { email, password, name, uid: null };
    account.uid = await lookupUid(email, password);
    // Most people tap the link in the verification email (the emulator
    // marks the account verified), then "I've verified it".
    if (account.uid && rng() < 0.75) {
      await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-lh/accounts:update', {
        method: 'POST',
        headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: account.uid, emailVerified: true }),
      }).catch(() => {});
      account.verified = true;
      step('verify email (link in the email)');
      if (/#\/profile/.test(safeHash())) await clickMatching(/verified it/i);
    }
    if (account.uid) pool.addAccount({ ...account });
    return true;
  };

  const signIn = async (acct) => {
    await goto('/profile');
    step(`sign in as ${acct.email}`);
    await page.fill('#email', acct.email).catch(() => {});
    await page.fill('#password', acct.password).catch(() => {});
    await page.click('form button[type=submit]').catch(() => {});
    await page.waitForFunction(() => !document.querySelector('#password'), null, { timeout: 8000 }).catch(() => add('harness', 'sign-in did not finish in 8 s'));
    await settle(600);
    account = acct;
  };

  // Walks through onboarding the way a new user does: mostly the primary
  // button, sometimes a card answer or skip.
  const doOnboarding = async () => {
    for (let i = 0; i < 30; i += 1) {
      const h = safeHash();
      if (!/onboarding/.test(h)) break;
      const list = await clickables(page).catch(() => []);
      if (!list.length) {
        await settle(500);
        continue;
      }
      const primaries = list.filter((c) => c.primary);
      const c = primaries.length && rng() < 0.6 ? pick(rng, primaries) : pick(rng, list);
      actionNo += 1;
      step(`onboarding: click "${c.label}"`);
      await clickEl(c);
      await checks();
    }
  };

  // ---------- after-action checks ----------
  const seen = { boundary: 0, stuck: 0, blank: 0 };
  const scanned = new Set();
  async function checks() {
    // The overflow scan measures every element, so it runs once per screen
    // (and sheet) per session, plus now and then.
    const scanKey = await page.evaluate(() => location.hash.replace(/\?.*/, '') + (document.querySelector('.modal-backdrop, [role=dialog]') ? '+sheet' : '')).catch(() => '');
    const scan = persona.viewport.width < 500 && (!scanned.has(scanKey) || rng() < 0.05);
    scanned.add(scanKey);
    const s = await page.evaluate(({ scan, vw }) => {
      const sim = window.__sim || { boundary: [], stuck: [], blank: [] };
      // Elements wider than the screen (only the outermost offender). vw is
      // the phone's width, not innerWidth: a mobile browser widens its
      // layout viewport to fit content that sticks out.
      const offenders = [];
      if (scan && document.documentElement.scrollWidth > vw + 1) {
        offenders.push({ sel: 'page', text: `page is ${document.documentElement.scrollWidth}px wide`, over: document.documentElement.scrollWidth - vw });
      }
      if (scan) {
        const clipped = (el) => {
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
          }
          return false;
        };
        for (const el of document.querySelectorAll('main *, header *, nav *, .modal-card *, .modal-card')) {
          if (el.closest('.leaflet-container')) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || r.right <= vw + 1) continue;
          if (r.left >= vw) continue; // off-canvas drawers
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05 || cs.position === 'fixed') continue;
          if (clipped(el)) continue;
          const parent = el.parentElement;
          const pr = parent?.getBoundingClientRect();
          if (pr && pr.right > vw + 1 && !clipped(parent)) continue; // parent already counted
          const cls = String(el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.');
          offenders.push({ sel: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`, text: (el.innerText || '').trim().slice(0, 50), over: Math.round(r.right - vw) });
          if (offenders.length > 3) break;
        }
      }
      // Floating controls (fixed or absolute) that sit on part of each
      // other, like a menu over a button: one of them cannot be tapped.
      const overlaps = [];
      if (scan) {
        // Only controls that stay put on screen (inside something fixed):
        // list rows scrolling under a fixed bar are expected.
        const floating = (el) => {
          for (let p = el; p && p !== document.body; p = p.parentElement) {
            if (getComputedStyle(p).position === 'fixed') return true;
          }
          return false;
        };
        const ctrls = [...document.querySelectorAll('main button, main select, main a[href], main input')]
          .filter((e) => !e.closest('.leaflet-container, .bottom-nav, .modal-backdrop, [role=dialog], [role=menu]'))
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).visibility !== 'hidden';
          })
          .filter(floating)
          .slice(0, 60);
        for (let i = 0; i < ctrls.length; i += 1) {
          for (let j = i + 1; j < ctrls.length; j += 1) {
            if (ctrls[i].contains(ctrls[j]) || ctrls[j].contains(ctrls[i])) continue;
            const a = ctrls[i].getBoundingClientRect();
            const b = ctrls[j].getBoundingClientRect();
            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            const name = (e) => (e.getAttribute('aria-label') || e.innerText || e.className || e.tagName).toString().trim().slice(0, 30);
            if (w > 2 && h > 2) overlaps.push(`"${name(ctrls[i])}" and "${name(ctrls[j])}" overlap ${Math.round(w)}x${Math.round(h)}px`);
          }
        }
      }
      return { boundary: sim.boundary, stuck: sim.stuck, blank: sim.blank, offenders, overlaps };
    }, { scan, vw: persona.viewport.width }).catch(() => null);
    if (!s) return;
    for (const b of s.boundary.slice(seen.boundary)) add(b.offline || (offline && /dynamically imported/.test(b.details)) ? 'boundary-offline' : 'boundary', `Something went wrong on ${b.hash}: ${b.details}`, { boundaryHash: b.hash });
    for (const b of s.stuck.slice(seen.stuck)) add('stuck', `Loading stuck ${Math.round(b.ms / 1000)}s on ${b.hash}: ${b.sig}`, { sig: b.sig });
    for (const b of s.blank.slice(seen.blank)) add('blank', `Blank screen on ${b.hash}`);
    seen.boundary = s.boundary.length;
    seen.stuck = s.stuck.length;
    seen.blank = s.blank.length;
    for (const o of s.offenders) add('overflow', `${o.sel} sticks out ${o.over}px: "${o.text}"`, { sel: o.sel });
    for (const o of s.overlaps || []) add('overlap', o);
  }

  // ---------- actions ----------
  const ACTIONS = {
    async tab() {
      const tabs = await clickables(page, { includeNav: true }).then((l) => l.filter((c) => c.inNav)).catch(() => []);
      if (!tabs.length) return goto(pick(rng, ['/', '/landmarks', '/mapr', '/itinerary', '/profile']));
      const c = pick(rng, tabs);
      step(`tab "${c.label}"`);
      if (rng() < 0.08) {
        step('  (double tap)');
        return clickEl(c, { dbl: true });
      }
      return clickEl(c);
    },
    async click() {
      const list = (await clickables(page).catch(() => [])).filter((c) => !DANGER.test(c.label) && (!RARE.test(c.label) || rng() < 0.05));
      if (!list.length) return null;
      // Real people tap what's on screen; markers are a small share.
      const nonMarkers = list.filter((c) => !c.marker);
      const c = nonMarkers.length && rng() < 0.85 ? pick(rng, nonMarkers) : pick(rng, list);
      step(`click "${c.label}"${c.inModal ? ' (in sheet)' : ''}`);
      return clickEl(c, { dbl: kind === 'chaos' && rng() < 0.3 });
    },
    async type() {
      const list = await fillables(page).catch(() => []);
      if (!list.length) return ACTIONS.click();
      const f = pick(rng, list);
      const loc = page.locator(`[data-sim-id="${f.id}"]`);
      if (f.tag === 'SELECT') {
        if (!f.options.length) return null;
        const v = pick(rng, f.options);
        step(`select "${v}" in "${f.label || f.name || f.placeholder}"`);
        await loc.selectOption(v, { timeout: 2500 }).catch(() => {});
        return settle(400);
      }
      const v = textFor(rng, f);
      step(`type "${v.slice(0, 40)}${v.length > 40 ? '…' : ''}" into "${f.placeholder || f.label || f.name}"`);
      await loc.fill(v, { timeout: 2500 }).catch(() => {});
      await settle(350);
      if (rng() < 0.5) {
        step('  press Enter');
        await loc.press('Enter', { timeout: 1500 }).catch(() => {});
        await settle(500);
      }
      return true;
    },
    async back() {
      if (rng() < 0.5 && (await clickMatching(/^(←|‹|<|Back)|back$/i))) return true;
      step('browser back');
      await page.goBack({ timeout: 5000, waitUntil: 'domcontentloaded' }).catch(() => {});
      await settle(500);
      // Back from the first screen leaves the app; the user opens it again.
      if (!page.url().startsWith(base)) {
        step('  (left the app, opens it again)');
        loaded = false;
        await goto('/');
      }
      return true;
    },
    async reload() {
      if (offline) return ACTIONS.back();
      step('reload');
      await page.reload({ waitUntil: 'domcontentloaded' }).catch((e) => add('harness', `reload: ${e.message.split('\n')[0]}`));
      return settle(1200);
    },
    async deeplink() {
      const r = rng() < 0.5 ? randomLandmarkRoute(rng, persona.region).route : pick(rng, ROUTES);
      const fresh = rng() < 0.3;
      step(`open link #${r}${fresh && !offline ? ' (fresh load)' : ''}`);
      return goto(r, { fresh });
    },
    async offline() {
      offline = !offline;
      step(offline ? 'go offline' : 'back online');
      await context.setOffline(offline).catch(() => {});
      return settle(400);
    },
    async scroll() {
      const dy = Math.floor((rng() - 0.3) * 2400);
      step(`scroll ${dy}px`);
      await page.mouse.wheel(0, dy).catch(() => {});
      return settle(250);
    },
    async escape() {
      step('press Escape');
      await page.keyboard.press('Escape').catch(() => {});
      return settle(250);
    },
    async move() {
      const c = pick(rng, CITIES);
      step(`move to ${c.name}`);
      await context.setGeolocation({ latitude: c.lat, longitude: c.lng, accuracy: 20 }).catch(() => {});
      return settle(200);
    },
    // ---- flows ----
    async maprChat() {
      if (!/#\/mapr/.test(safeHash())) await goto('/mapr');
      const msg = pick(rng, CHAT);
      if (!(await fillMatching(/up for|Ask|Message|Mapr/i, msg))) return ACTIONS.click();
      if (rng() < 0.8) await clickMatching(/^➤$|Send/i);
      else {
        step('  press Enter');
        await page.keyboard.press('Enter').catch(() => {});
      }
      await settle(1500);
      if (rng() < 0.6) await clickMatching(/More like this|cheaper|whole day|open late|Closer|Add|Itinerary|Directions|rate|★|Save/i);
      return true;
    },
    async placesSearch() {
      if (!/#\/landmarks$/.test(safeHash())) await goto('/landmarks');
      await fillMatching(/Search landmarks/i, pick(rng, SEARCHES));
      await settle(700);
      if (rng() < 0.6) await clickMatching(/For Me|Near Me|Popular|Checked in|Miami|▼|🏛️|🍽️|🍸|🌳|🏀|🛍️|🎢|💻/);
      if (rng() < 0.6) await clickMatching(/^Info$|Save .* for later|Share /);
      return true;
    },
    async landmark() {
      const { route, place } = randomLandmarkRoute(rng, persona.region);
      if (rng() < 0.4 && persona.location === 'on') {
        step(`stand at ${place.name}`);
        await context.setGeolocation({ latitude: place.lat, longitude: place.lng, accuracy: 15 }).catch(() => {});
      }
      step(`open ${route}`);
      await goto(route);
      const what = pick(rng, [/Check In/i, /Rate|★|star/i, /Save|later/i, /Share/i, /Directions/i, /Itinerary|Add to/i, /tip/i, /photo/i]);
      await clickMatching(what);
      if (rng() < 0.6) await clickMatching(/star|★|Submit|Save|Done|Post|Yes|Love|Like|Next/i);
      return true;
    },
    async mapExplore() {
      if (safeHash() !== '#/') await goto('/');
      const what = pick(rng, ['search', 'picked', 'within', 'marker', 'locate', 'add']);
      if (what === 'search') {
        await clickMatching(/^🔍$/);
        await fillMatching(/Search landmarks/i, pick(rng, SEARCHES));
        await settle(600);
        await clickMatching(/./);
      } else if (what === 'picked') {
        await clickMatching(/Picked for you|🗂️|For you/i);
        await clickMatching(/./);
      } else if (what === 'within') {
        const list = (await fillables(page).catch(() => [])).filter((f) => f.tag === 'SELECT');
        if (list.length) {
          const v = pick(rng, list[0].options);
          step(`Within ${v}`);
          await page.locator(`[data-sim-id="${list[0].id}"]`).selectOption(v).catch(() => {});
        }
        await clickMatching(/km|mi|Within/i);
      } else if (what === 'marker') {
        const list = (await clickables(page).catch(() => [])).filter((c) => c.marker);
        if (list.length) {
          const c = pick(rng, list);
          step(`tap map pin "${c.label}"`);
          await clickEl(c);
          await clickMatching(/Info|Details|Directions|Check In|Save|Rate/i);
        }
      } else if (what === 'locate') {
        await clickMatching(/locat|me|➤/i);
      } else await clickMatching(/^➕$/);
      return true;
    },
    async itinerary() {
      if (!/#\/itinerary/.test(safeHash())) await goto('/itinerary');
      const what = pick(rng, [/Create New Trip/i, /Use Mapr/i, /Start Trip|Start/i, /Share/i, /Group|Friends|Invite|Add member/i, /Add stop|Add/i, /Live|location/i, /Delete|Remove/i]);
      await clickMatching(what);
      if (rng() < 0.7) await ACTIONS.type();
      if (rng() < 0.6) await clickMatching(/Create|Save|Next|Done|Start|Continue|Add/i);
      return true;
    },
    async profile() {
      await goto(pick(rng, ['/profile', '/settings', '/streaks', '/stats', '/notifications', '/checkins', '/cities', '/mapr-ratings', '/leaderboard/full']));
      return ACTIONS.click();
    },
  };

  const MIX = {
    newUser: [['tab', 12], ['click', 30], ['type', 10], ['back', 5], ['reload', 2], ['deeplink', 3], ['offline', 1], ['scroll', 5], ['escape', 2], ['move', 1], ['maprChat', 7], ['placesSearch', 6], ['landmark', 7], ['mapExplore', 6], ['itinerary', 5], ['profile', 3]],
    returning: [['tab', 10], ['click', 28], ['type', 8], ['back', 5], ['reload', 3], ['deeplink', 3], ['offline', 2], ['scroll', 4], ['escape', 2], ['move', 2], ['maprChat', 8], ['placesSearch', 5], ['landmark', 10], ['mapExplore', 6], ['itinerary', 6], ['profile', 6]],
    groupTrip: [['tab', 8], ['click', 25], ['type', 8], ['back', 4], ['reload', 2], ['deeplink', 2], ['offline', 2], ['scroll', 3], ['escape', 2], ['move', 3], ['maprChat', 6], ['placesSearch', 3], ['landmark', 6], ['mapExplore', 4], ['itinerary', 20], ['profile', 4]],
    guest: [['tab', 15], ['click', 30], ['type', 10], ['back', 6], ['reload', 2], ['deeplink', 6], ['offline', 1], ['scroll', 6], ['escape', 2], ['move', 1], ['maprChat', 4], ['placesSearch', 8], ['landmark', 8], ['mapExplore', 8], ['itinerary', 3], ['profile', 2]],
    chaos: [['tab', 12], ['click', 30], ['type', 12], ['back', 10], ['reload', 8], ['deeplink', 10], ['offline', 8], ['scroll', 5], ['escape', 4], ['move', 4], ['maprChat', 4], ['placesSearch', 3], ['landmark', 4], ['mapExplore', 3], ['itinerary', 3], ['profile', 3]],
    desktopPlanner: [['tab', 10], ['click', 25], ['type', 10], ['back', 4], ['reload', 2], ['deeplink', 3], ['offline', 1], ['scroll', 3], ['escape', 2], ['move', 1], ['maprChat', 10], ['placesSearch', 6], ['landmark', 8], ['mapExplore', 6], ['itinerary', 12], ['profile', 3]],
  };

  let status = 'ok';
  const timing = {};
  try {
    // Entry: home, or a shared deep link.
    if (rng() < 0.12) {
      const r = randomLandmarkRoute(rng, persona.region).route;
      step(`open shared link #${r}`);
      await goto(r);
    } else {
      step('open app');
      await goto('/');
    }
    await checks();

    if (kind === 'newUser' || (kind !== 'guest' && !pool.size())) {
      await signUp();
      await doOnboarding();
    } else if (kind === 'returning' || kind === 'chaos' || kind === 'desktopPlanner') {
      const acct = pool.take(rng);
      if (acct) await signIn(acct);
    } else if (kind === 'groupTrip') {
      const acct = pool.take(rng);
      const friend = pool.take(rng);
      if (acct && friend && acct.uid && friend.uid && acct.uid !== friend.uid) {
        // Friends already: two accepted edges, as acceptRequest writes them.
        await adminSet(`friend_edges/${acct.uid}_${friend.uid}`, { owner: acct.uid, friend: friend.uid, friendName: friend.name, createdAt: new Date() });
        await adminSet(`friend_edges/${friend.uid}_${acct.uid}`, { owner: friend.uid, friend: acct.uid, friendName: acct.name, createdAt: new Date() });
        step(`friends with ${friend.name}`);
      }
      if (acct) await signIn(acct);
    }
    await checks();

    const mix = MIX[kind] || MIX.guest;
    while (actionNo < persona.actions) {
      actionNo += 1;
      const a = weighted(rng, kind === 'chaos' || persona.flakyNetwork ? mix : mix.filter(([n]) => n !== 'offline'));
      const t0 = Date.now();
      try {
        await ACTIONS[a]();
      } catch (e) {
        if (/Target page, context or browser has been closed/.test(e.message)) throw e;
        add('harness', `${a}: ${e.message.split('\n')[0]}`);
      }
      const t1 = Date.now();
      await checks();
      const t2 = Date.now();
      timing[a] = timing[a] || [0, 0, 0];
      timing[a][0] += 1;
      timing[a][1] += t1 - t0;
      timing[a][2] += t2 - t1;
      if (Date.now() - startedAt > opts.sessionTimeoutMs) {
        add('harness', 'session time limit reached');
        break;
      }
    }
    if (offline) await context.setOffline(false).catch(() => {});
    // Let late async errors land.
    await settle(800);
    await checks();
  } catch (e) {
    status = 'crashed';
    add('harness', `session aborted: ${e.message.split('\n')[0]}`);
  }

  if (offline) await context.setOffline(false).catch(() => {});
  await page.close().catch(() => {});
  out.push({
    index,
    seed,
    persona,
    status,
    actions: actionNo,
    ms: Date.now() - startedAt,
    steps,
    findings,
    api: stats.api,
    unknownApi: stats.unknownApi,
    external: stats.external,
    timing,
  });
}
