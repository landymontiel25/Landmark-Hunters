// Turns the raw neighborhood numbers (scripts/neighborhoods/metrics.json,
// fetched by scripts/fetch-neighborhood-metrics.mjs) into the 0-5 slider
// ratings. Every score is relative to the Miami-area neighborhoods in the
// file: 5 is the top neighborhood for that measure, 0 the bottom.
//
// Counts use a log scale between the lowest and highest neighborhood, so one
// very dense area (Brickell, South Beach) doesn't flatten everyone else to 0.
// Average Property Price uses the same scale on the median home value:
// 5 = the priciest tract. Safety has no source yet and stays null.
// Walkability counts every place in the other groups (food, nightlife,
// shops, culture). Counts are per km2 of the neighborhood's outline (or its
// 1 km circle), so a big city and a small district compare fairly; cuisine
// variety stays a plain count.

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
// artAndCulture, medianHomeValue } }
// Returns { [name]: ratings } in the data file's shape.
export function scoreNeighborhoods(metrics) {
  const rows = Object.entries(metrics);
  const col = (fn) => rows.map(([, m]) => fn(m));
  // Per km2 when the area is known; a plain count otherwise.
  const dens = (m, v) => (!isNum(v) ? null : isNum(m.area?.km2) && m.area.km2 > 0 ? v / m.area.km2 : v);
  const walkable = (m) => {
    const parts = [m.restaurants, m.nightlife, m.shopping, m.artAndCulture];
    return parts.some(isNum) ? dens(m, parts.filter(isNum).reduce((a, b) => a + b, 0)) : null;
  };
  const cols = {
    walkable: col(walkable),
    restaurants: col((m) => dens(m, m.restaurants)),
    cuisines: col((m) => (Array.isArray(m.cuisines) ? m.cuisines.length : null)),
    nightlife: col((m) => dens(m, m.nightlife)),
    home: col((m) => m.medianHomeValue),
    culture: col((m) => dens(m, m.artAndCulture)),
    shopping: col((m) => dens(m, m.shopping)),
  };
  const out = {};
  for (const [name, m] of rows) {
    out[name] = {
      safety: null,
      walkability: logScale(walkable(m), cols.walkable),
      restaurants: {
        quantity: logScale(dens(m, m.restaurants), cols.restaurants),
        price: null,
        diversity: logScale(Array.isArray(m.cuisines) ? m.cuisines.length : null, cols.cuisines),
      },
      nightlife: logScale(dens(m, m.nightlife), cols.nightlife),
      averagePropertyPrice: logScale(m.medianHomeValue, cols.home),
      artAndCulture: logScale(dens(m, m.artAndCulture), cols.culture),
      shopping: logScale(dens(m, m.shopping), cols.shopping),
    };
  }
  return out;
}
