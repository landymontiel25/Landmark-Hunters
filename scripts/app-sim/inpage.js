// Injected into every simulated page before the app loads (addInitScript).
// Counts DOM mutations (for "button did nothing"), and watches for
// error-boundary screens, blank screens and loading states stuck past 10 s.
// The harness reads window.__sim after each action.
(() => {
  if (window.__sim) return;
  const sim = { mut: 0, boundary: [], stuck: [], blank: [], opened: [], shared: 0 };
  window.__sim = sim;

  const startObserver = () => {
    try {
      new MutationObserver((list) => {
        sim.mut += list.length;
      }).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        // Not style: map animations rewrite it every frame.
        attributes: true,
        attributeFilter: ['class', 'disabled', 'hidden', 'open', 'aria-expanded', 'aria-pressed', 'aria-selected', 'aria-checked', 'value', 'src', 'href'],
      });
    } catch {
      /* ignore */
    }
  };
  startObserver();

  // No CSS transitions. Not shortened ones: a 1ms transition-duration gives
  // every element a transition on every property (transition-property
  // defaults to all), and in a busy headless browser those stall mid-way,
  // which looked like controls overlapping. Animations stay as they are: a
  // shortened pop-in animation stalled at its first frame left popups
  // invisible but still catching taps.
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important}';
  const addStyle = () => (document.head || document.documentElement).appendChild(style);
  if (document.head) addStyle();
  else document.addEventListener('DOMContentLoaded', addStyle, { once: true });

  // External links and share sheets: record, never leave the app.
  window.open = (url) => {
    sim.opened.push(String(url).slice(0, 200));
    return null;
  };
  try {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        sim.shared += 1;
      },
    });
  } catch {
    /* ignore */
  }

  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };

  const LOADING_TEXT = /^(Loading\b[^\n]{0,60}|Thinking[^\n]{0,30}|Signing in[^\n]{0,20}|Saving[^\n]{0,20})$/;
  const loadingSignature = () => {
    const sigs = [];
    for (const el of document.querySelectorAll('[class*="skeleton"], .autocomplete-loading, [aria-busy="true"]')) {
      if (visible(el)) {
        sigs.push((el.className && String(el.className).split(' ')[0]) || el.tagName);
        if (sigs.length > 3) break;
      }
    }
    // XPath finds a short "Loading…" text node without walking the tree in JS.
    try {
      const x = document.evaluate(
        "//main//text()[starts-with(normalize-space(.), 'Loading') or starts-with(normalize-space(.), 'Thinking') or starts-with(normalize-space(.), 'Signing in')]",
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      const t = x && x.nodeValue.trim();
      if (t && t.length < 80 && LOADING_TEXT.test(t) && visible(x.parentElement)) sigs.push(`text:${t}`);
    } catch {
      /* ignore */
    }
    return [...new Set(sigs)].sort().join('|');
  };

  let loadingSig = '';
  let loadingSince = 0;
  let loadingHash = '';
  let blankSince = 0;
  const reportedStuck = new Set();
  setInterval(() => {
    if (!document.body || location.protocol === 'chrome-error:') return;
    const now = Date.now();
    const hash = location.hash;
    // Error boundary screen.
    for (const h of document.querySelectorAll('h1.screen-title')) {
      if (/Something went wrong/.test(h.textContent || '')) {
        const details = [...h.parentElement.querySelectorAll('p')].map((p) => p.textContent).find((t) => /^Details:/.test(t)) || '';
        const key = `${hash}|${details}`;
        if (!sim.boundary.some((b) => b.key === key)) sim.boundary.push({ key, hash, details: details.slice(0, 300), at: now, offline: navigator.onLine === false });
      }
    }
    // Stuck loading state (same indicator on the same screen for 10 s).
    // Offline time does not count: a screen may wait for the network.
    const sig = navigator.onLine === false ? '' : loadingSignature();
    if (sig && sig === loadingSig && hash === loadingHash) {
      if (now - loadingSince > 10000 && !reportedStuck.has(`${hash}|${sig}`)) {
        reportedStuck.add(`${hash}|${sig}`);
        sim.stuck.push({ hash, sig, ms: now - loadingSince, at: now });
      }
    } else {
      loadingSig = sig;
      loadingHash = hash;
      loadingSince = now;
    }
    // Blank screen: almost no text and no map for 4 s.
    const text = (document.body.textContent || '').trim();
    const hasMap = !!document.querySelector('.leaflet-container');
    if (text.length < 15 && !hasMap) {
      if (!blankSince) blankSince = now;
      else if (now - blankSince > 4000 && !sim.blank.some((b) => b.hash === hash)) sim.blank.push({ hash, at: now, text });
    } else blankSince = 0;
  }, 2000);
})();
