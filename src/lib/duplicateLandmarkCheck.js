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

// Loose enough to catch "Hillstone" vs "Hillstone Restaurant" (substring), and
// "Helstone" vs "Hillstone" (a plain typo -- close enough in edit distance
// that a person would recognize it as the same place, even though it's not
// a substring match). Strict enough not to flag two unrelated places that
// just share a common word, or names that are only vaguely similar.
function namesMatch(a, b) {
  const norm = (s) => s.trim().toLowerCase();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;

  // Compare the shorter string against each individual word of the longer
  // one -- "Helstone" should match against "Hillstone" inside "Hillstone
  // Restaurant" even though the two full strings are very different lengths.
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  const candidates = [longer, ...longer.split(/\s+/)];
  return candidates.some((word) => {
    if (Math.abs(word.length - shorter.length) > 3) return false;
    const threshold = Math.max(1, Math.round(Math.min(word.length, shorter.length) * 0.3));
    return levenshtein(shorter, word) <= threshold;
  });
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

  const builtIn = ALL_LANDMARKS.find((l) => l.regionId === regionId && namesMatch(l.name, trimmed));
  if (builtIn) return { name: builtIn.name, region: builtIn.regionId, id: builtIn.id };

  const existing = await getCustomLandmarks().catch(() => []);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
  const match = existing.find(
    (l) =>
      namesMatch(l.name, trimmed) &&
      (l.region === regionId ||
        (l.region === CUSTOM_REGION && hasPoint && distanceMeters(lat, lng, l.lat, l.lng) <= SAME_AREA_METERS))
  );
  return match ? { name: match.name, region: match.region, id: match.id } : null;
}
