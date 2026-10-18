// Places Mapr chat found through its own Google lookups this reply
// (route_between, best_order, place_hours). A place a lookup found is real,
// so its card can show without a web source URL (owner, 2026-10-18: tennis
// courts named with distances but no cards).

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Not places: the traveler's own position and best_order's total row.
const NOT_PLACES = new Set(['your location', 'my location', 'start', 'last stop']);

export function lookedUpPlaces(toolResults = []) {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    const name = String(p?.name || '').trim();
    const key = norm(name);
    if (!key || NOT_PLACES.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ name: name.slice(0, 120), address: String(p?.address || '').trim().slice(0, 160) });
  };
  for (const { tool, out: r } of toolResults) {
    if (!r || typeof r !== 'object') continue;
    if (tool === 'place_hours') {
      // A closed-for-good place is no suggestion.
      if (!r.error && !r.permanentlyClosed) add(r);
      continue;
    }
    if (r.error) continue;
    if (r.from || r.to) {
      add(r.from);
      add(r.to);
    }
    for (const leg of Array.isArray(r.legs) ? r.legs : []) {
      add(leg.from);
      add(leg.to);
    }
  }
  return out;
}

// The looked-up place a stop's name refers to: the same words, or one name
// holding the other ("Salvadore Park" vs "Salvadore Park Tennis Center").
export function findLookedUp(name, places = []) {
  const n = norm(name);
  if (n.length < 4) return null;
  return (
    places.find((p) => norm(p.name) === n) ||
    places.find((p) => {
      const m = norm(p.name);
      return m.length >= 4 && (` ${m} `.includes(` ${n} `) || ` ${n} `.includes(` ${m} `));
    }) ||
    null
  );
}

// Looked-up places the reply names, in the order it names them.
export function lookedUpNamedIn(reply, places = []) {
  const text = ` ${norm(reply)} `;
  return places
    .map((p) => ({ p, at: text.indexOf(` ${norm(p.name)} `) }))
    .filter((x) => norm(x.p.name).length >= 4 && x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.p);
}
