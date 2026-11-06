// Turns the raw neighborhood numbers (scripts/neighborhoods/metrics.json,
// fetched by scripts/fetch-neighborhood-metrics.mjs) into the 0-5 slider
// ratings. Every score is relative to the Miami-area neighborhoods in the
// file: 5 is the top neighborhood for that measure, 0 the bottom.
//
// Counts use a log scale between the lowest and highest neighborhood, so one
// very dense area (Brickell, South Beach) doesn't flatten everyone else to 0.
// Average Property Price uses the same scale on the median home value:
// 5 = the priciest tract. Safety has no source yet and stays null.

const round1 = (v) => Math.round(v * 10) / 10;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// 0-5 on a log scale between the smallest and largest value in `values`.
export function logScale(value, values) {
  if (!isNum(value)) return null;
  const nums = values.filter(isNum);
  if (!nums.length) return null;
  const lo = Math.log1p(Math.min(...nums));
  const hi = Math.log1p(Math.max(...nums));
  if (hi === lo) return nums.length === 1 ? 5 : 2.5;
  return round1(Math.max(0, Math.min(5, ((Math.log1p(value) - lo) / (hi - lo)) * 5)));
}

// metrics: { [name]: { restaurants, cuisines: [], nightlife, shopping,
// artAndCulture, walkable, medianHomeValue } }
// Returns { [name]: ratings } in the data file's shape.
export function scoreNeighborhoods(metrics) {
  const rows = Object.entries(metrics);
  const col = (fn) => rows.map(([, m]) => fn(m));
  const cols = {
    walkable: col((m) => m.walkable),
    restaurants: col((m) => m.restaurants),
    cuisines: col((m) => (Array.isArray(m.cuisines) ? m.cuisines.length : null)),
    nightlife: col((m) => m.nightlife),
    home: col((m) => m.medianHomeValue),
    culture: col((m) => m.artAndCulture),
    shopping: col((m) => m.shopping),
  };
  const out = {};
  for (const [name, m] of rows) {
    out[name] = {
      safety: null,
      walkability: logScale(m.walkable, cols.walkable),
      restaurants: {
        quantity: logScale(m.restaurants, cols.restaurants),
        price: null,
        diversity: logScale(Array.isArray(m.cuisines) ? m.cuisines.length : null, cols.cuisines),
      },
      nightlife: logScale(m.nightlife, cols.nightlife),
      averagePropertyPrice: logScale(m.medianHomeValue, cols.home),
      artAndCulture: logScale(m.artAndCulture, cols.culture),
      shopping: logScale(m.shopping, cols.shopping),
    };
  }
  return out;
}
