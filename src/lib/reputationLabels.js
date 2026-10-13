import { getRegion } from '../data/regions.js';
import { LEVEL_RANK } from './reputation.js';

// How levels and badges read (Phase 4). Never points.
export const levelLabel = (level, region) => `${level} in ${getRegion(region)?.name || region}`;

export function badgeLabel(id) {
  if (id === 'first-find') return { icon: '\u{1F4A1}', text: 'First find' };
  if (id === 'went-10') return { icon: '\u{1F6B6}', text: '10 went because of you' };
  const m = /^(trusted|founding)-(.+)$/.exec(id || '');
  if (!m) return null;
  const city = getRegion(m[2])?.name || m[2];
  return m[1] === 'trusted' ? { icon: '\u{2B50}', text: `Trusted in ${city}` } : { icon: '\u{1F3C5}', text: `Founding discoverer, ${city}` };
}

// A reputation doc's levels, best first: [{ region, level, label }].
export function levelsOf(doc) {
  return Object.entries(doc?.levels || {})
    .filter(([, level]) => LEVEL_RANK[level])
    .sort((a, b) => LEVEL_RANK[b[1]] - LEVEL_RANK[a[1]] || a[0].localeCompare(b[0]))
    .map(([region, level]) => ({ region, level, label: levelLabel(level, region) }));
}
