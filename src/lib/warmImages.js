// Starts downloading photos before their tiles scroll into view, so a grid
// (My Memories) fills in fast (owner, 2026-11-09). The first `first` go out
// at once at high priority; the rest follow `batch` at a time. The browser
// keeps what it fetched, so the tiles then paint from cache. Returns a
// function that stops the rest. A URL is only started once per page load.
const started = new Set();

export function warmImages(urls, { first = 12, batch = 4, ImageCtor = typeof Image === 'undefined' ? null : Image } = {}) {
  if (!ImageCtor) return () => {};
  const todo = [...new Set((urls || []).filter((u) => typeof u === 'string' && u && !started.has(u)))];
  let stopped = false;
  const load = (url, priority) => {
    started.add(url);
    const img = new ImageCtor();
    img.decoding = 'async';
    if (priority) img.fetchPriority = priority;
    return new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = url;
    });
  };
  (async () => {
    // The rest wait for the first ones, so they never compete with them.
    await Promise.all(todo.slice(0, first).map((u) => load(u, 'high')));
    const rest = todo.slice(first);
    for (let i = 0; i < rest.length && !stopped; i += batch) {
      await Promise.all(rest.slice(i, i + batch).map((u) => load(u, 'low')));
    }
  })();
  return () => {
    stopped = true;
  };
}

// Tests only.
export function _resetWarmImages() {
  started.clear();
}
