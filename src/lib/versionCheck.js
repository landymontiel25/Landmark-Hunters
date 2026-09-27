// A desktop tab can stay open for days and keep running an old build. When
// the tab comes back after a long break and the server has a newer build,
// reload so every device runs the same code. Short trips away (the photo
// picker, a quick app switch) never trigger it.
const AWAY_MS = 30 * 60 * 1000;
const bundleRe = /\/assets\/index-[\w-]+\.js/;

export function currentBundle(doc = document) {
  const src = [...doc.querySelectorAll('script[type="module"][src]')].map((s) => s.getAttribute('src')).find((s) => bundleRe.test(s));
  return src ? src.match(bundleRe)[0] : null;
}

export function latestBundle(html) {
  return html.match(bundleRe)?.[0] || null;
}

export function watchForNewVersion({ fetchHtml = () => fetch('/', { cache: 'no-store' }).then((r) => r.text()), reload = () => location.reload() } = {}) {
  const mine = currentBundle();
  if (!mine) return () => {};
  let hiddenAt = null;
  const onChange = async () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    if (away < AWAY_MS) return;
    try {
      const latest = latestBundle(await fetchHtml());
      if (latest && latest !== mine) reload();
    } catch {
      /* offline: keep what's running */
    }
  };
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}
