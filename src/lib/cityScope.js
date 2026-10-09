// Where a list is limited to: everywhere, a state or country, one app city
// (region), or one town inside a city (South Florida's Miami, Silicon Valley's
// Palo Alto). A scope is a short key so it can be saved and compared:
//   'all' | 'g:<group id>' | 'r:<region id>' | 'a:<region id>:<town name>'
// A bare region id (older saved values) reads as 'r:<id>'.
import { PICKABLE_REGIONS, getRegion, canonicalRegionId } from '../data/regions';
import { SUB_AREAS } from '../data/cityAreas';
import { matchesSearch } from './search';

// US cities group by state, everywhere else by country. South Florida is the
// only part of Florida in the app, so its state goes by that name.
const GROUP_LABEL = { 'us-Florida': 'South Florida' };
const groupIdOf = (r) => (r.country === 'USA' ? `us-${r.state}` : `c-${r.country}`);

export const CITY_GROUPS = (() => {
  const byId = new Map();
  for (const r of PICKABLE_REGIONS) {
    const id = groupIdOf(r);
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        label: GROUP_LABEL[id] || (r.country === 'USA' ? r.state : r.country),
        state: r.country === 'USA' ? r.state : '',
        country: r.country,
        regionIds: [],
      });
    }
    byId.get(id).regionIds.push(r.id);
  }
  return [...byId.values()]
    .map((g) => {
      const regions = g.regionIds.map(getRegion);
      // The line under it: a lone city's towns, else the cities it holds.
      const sub = regions.length === 1 ? regions[0].subtitle || regions[0].city : regions.map((r) => r.city).join(', ');
      return { ...g, sub };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
})();

export const groupOfRegion = (regionId) => CITY_GROUPS.find((g) => g.regionIds.includes(canonicalRegionId(regionId))) || null;

// A group with one city is that city.
const groupKey = (g) => (g.regionIds.length === 1 ? `r:${g.regionIds[0]}` : `g:${g.id}`);

export function scopeFromKey(key) {
  if (!key || key === 'all') return { key: 'all', label: 'All Cities', regionIds: null, area: null };
  if (key.startsWith('g:')) {
    const g = CITY_GROUPS.find((x) => x.id === key.slice(2));
    return g ? { key, label: g.label, regionIds: g.regionIds, area: null } : scopeFromKey('all');
  }
  if (key.startsWith('a:')) {
    const [, regionId, ...rest] = key.split(':');
    const name = rest.join(':');
    const area = (SUB_AREAS[regionId] || []).find((a) => a.name === name);
    return area ? { key, label: name, regionIds: [regionId], area } : scopeFromKey(`r:${regionId}`);
  }
  const id = canonicalRegionId(key.startsWith('r:') ? key.slice(2) : key);
  const r = getRegion(id);
  return r ? { key: `r:${r.id}`, label: r.city, regionIds: [r.id], area: null } : scopeFromKey('all');
}

// The one city a scope is inside, or null for everywhere / a whole state.
export const scopeRegionId = (scope) => (scope.regionIds?.length === 1 ? scope.regionIds[0] : null);

// Ray casting over [lat, lng] rings.
function insideRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function metersBetween(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Is this point in the town: inside its outline, or within its radius when
// the town is mapped as a point (a neighborhood like Brickell).
export function inArea(lat, lng, area) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !area) return false;
  if (area.area) return area.area.some((ring) => insideRing(lat, lng, ring));
  if (area.radius) return metersBetween(lat, lng, area.lat, area.lng) <= area.radius;
  return false;
}

export function inScope(landmark, scope) {
  if (!scope?.regionIds) return true;
  const regionId = canonicalRegionId(landmark.regionId ?? landmark.region);
  if (!scope.regionIds.includes(regionId)) return false;
  return scope.area ? inArea(landmark.lat, landmark.lng, scope.area) : true;
}

const regionLine = (r) => r.subtitle || [r.state, r.country].filter(Boolean).join(', ');

// Rows for a city picker: with no query, everywhere plus each state or
// country; with one, every state or country, city and town it matches (a
// state's or country's cities come along, so "California" lists San
// Francisco and Silicon Valley, and "Western Cape" lists Cape Town).
// Each row: { key, primary, secondary }. Names that start with the query
// come first.
export function scopeRows(query, { withAll = true } = {}) {
  const q = (query || '').trim();
  const all = { key: 'all', primary: 'All Cities', secondary: 'Landmarks from every city' };
  if (!q) return [...(withAll ? [all] : []), ...CITY_GROUPS.map((g) => ({ key: groupKey(g), primary: g.label, secondary: g.sub }))];
  const rows = [];
  const seen = new Set();
  const add = (row) => {
    if (seen.has(row.key)) return;
    seen.add(row.key);
    rows.push(row);
  };
  for (const g of CITY_GROUPS) {
    if (!matchesSearch([g.label, g.state, g.country].filter(Boolean).join(' '), q)) continue;
    add({ key: groupKey(g), primary: g.label, secondary: g.sub });
    for (const id of g.regionIds) {
      const r = getRegion(id);
      add({ key: `r:${r.id}`, primary: r.city, secondary: regionLine(r) });
    }
  }
  for (const r of PICKABLE_REGIONS) {
    if (matchesSearch([r.name, r.city, r.state, r.country].filter(Boolean).join(' '), q)) add({ key: `r:${r.id}`, primary: r.city, secondary: regionLine(r) });
  }
  for (const [regionId, areas] of Object.entries(SUB_AREAS)) {
    const r = getRegion(regionId);
    for (const a of areas) {
      if (matchesSearch([a.name, ...(a.aliases || [])].join(' '), q)) add({ key: `a:${regionId}:${a.name}`, primary: a.name, secondary: r.name });
    }
  }
  const lower = q.toLowerCase();
  const rank = (row) => (row.primary.toLowerCase() === lower ? 0 : row.primary.toLowerCase().startsWith(lower) ? 1 : 2);
  return [...(withAll && matchesSearch(all.primary, q) ? [all] : []), ...rows.map((row, i) => ({ row, i })).sort((a, b) => rank(a.row) - rank(b.row) || a.i - b.i).map(({ row }) => row)];
}
