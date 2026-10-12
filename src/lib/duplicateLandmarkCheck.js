import { ALL_LANDMARKS } from '../data/regions';
import { getCustomLandmarks, CUSTOM_REGION } from './customLandmarks';
import { distanceMeters } from './geo';

// A region-less custom pin has no city to compare, so it counts as the same
// area when it's this close to the one being added.
const SAME_AREA_METERS = 50_000;

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Words that don't tell two places apart: "Hillstone" and "Hillstone
// Restaurant" are the same place.
const FILLER = new Set(['the', 'restaurant', 'cafe', 'café', 'bar', 'grill', 'kitchen', 'eatery', 'miami', 'fl', 'inc', 'llc']);
const core = (s) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .join(' ');

// Same name once filler words are dropped ("Hillstone" and "Hillstone
// Restaurant"), or a plain typo of it ("Helstone"). A name that only starts
// the same is a different place: "Cocoplum Yacht Club" is not "Cocoplum".
function namesMatch(a, b) {
  const x = core(a);
  const y = core(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.abs(x.length - y.length) > 3) return false;
  const threshold = Math.max(1, Math.round(Math.min(x.length, y.length) * 0.3));
  return levenshtein(x, y) <= threshold;
}

// One name inside the other ("Joe's" in "Joe's Stone Crab") only counts at
// the same spot, so a neighborhood's name never flags every place in it.
const SAME_SPOT_METERS = 150;
function partOfName(a, b) {
  const x = core(a);
  const y = core(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

// Is there already a landmark by this name in this region -- the built-in
// catalog, or someone else's submission (every submission is live the
// moment it's added, there's no pending queue to also check). Same-region
// rather than exact-distance: good enough to catch "I'm re-adding the
// Hillstone that's already here" without also flagging an unrelated
// same-named chain location in a different city.
export async function findPossibleDuplicate({ name, regionId, lat, lng }) {
  const trimmed = (name || '').trim();
  if (trimmed.length < 2 || !regionId) return null;

  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
  const sameSpot = (l) => hasPoint && Number.isFinite(l.lat) && Number.isFinite(l.lng) && distanceMeters(lat, lng, l.lat, l.lng) <= SAME_SPOT_METERS;
  const nameHit = (l) => namesMatch(l.name, trimmed) || (partOfName(l.name, trimmed) && sameSpot(l));

  const builtIn = ALL_LANDMARKS.find((l) => l.regionId === regionId && nameHit(l));
  if (builtIn) return { name: builtIn.name, region: builtIn.regionId, id: builtIn.id };

  const existing = await getCustomLandmarks().catch(() => []);
  const match = existing.find(
    (l) =>
      nameHit(l) &&
      (l.region === regionId ||
        (l.region === CUSTOM_REGION && hasPoint && distanceMeters(lat, lng, l.lat, l.lng) <= SAME_AREA_METERS))
  );
  return match ? { name: match.name, region: match.region, id: match.id } : null;
}
