import { useEffect, useMemo, useState } from 'react';
import { auth } from './firebase';
import { authHeaders } from './apiAuth';
import { PICKABLE_REGIONS } from '../data/regions';
import { API_BASE } from './apiBase';

// The AI half of every search box (api/smart-search.js). Each screen's own
// search (matchesSearch -- already typo-tolerant) runs first; this only
// kicks in when that finds fewer than `minLocal` results, to catch what a
// word match never will: "the big clock in london", "rocky steps", a
// nickname, a translation, a badly misspelled name.
//
// catalog: true lets the server search the built-in landmarks itself
// (returned as "regionId/landmarkId"); `items` ({ id, text }) are the
// screen's own things -- your check-ins, the city list, custom landmarks.
// Debounced, cached per query for the session, signed-in only (it's an AI
// call), and silent on failure -- the plain results still stand.

const DEBOUNCE_MS = 600;
const MIN_QUERY = 3;
const cache = new Map();

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function useSmartSearch({ query, localCount, catalog = false, items = [], minLocal = 3, enabled = true }) {
  const q = String(query || '').trim().toLowerCase();
  const itemsKey = useMemo(() => hash(items.map((i) => `${i.id}:${i.text}`).join('|')), [items]);
  const key = `${catalog ? 'c' : ''}|${itemsKey}|${q}`;
  const signedIn = !!auth?.currentUser;
  const want = enabled && signedIn && q.length >= MIN_QUERY && localCount < minLocal && (catalog || items.length > 0);
  const [state, setState] = useState({ key: null, ids: [], loading: false });

  useEffect(() => {
    if (!want) return undefined;
    if (cache.has(key)) {
      setState({ key, ids: cache.get(key), loading: false });
      return undefined;
    }
    setState({ key, ids: [], loading: true });
    let cancelled = false;
    const t = setTimeout(async () => {
      let ids = [];
      try {
        const res = await fetch(`${API_BASE}/api/smart-search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ query: q, catalog, items: items.slice(0, 400) }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && Array.isArray(data?.ids)) {
          ids = data.ids;
          cache.set(key, ids);
        }
      } catch {
        /* offline -- the plain results stand */
      }
      if (!cancelled) setState({ key, ids, loading: false });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // items/catalog are folded into `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, key]);

  const current = want && state.key === key;
  return { ids: current ? state.ids : [], loading: current && state.loading };
}

// One line describing a catalog landmark for `items` (custom landmarks).
export function landmarkSearchText(l, cityName) {
  return [l.name, cityName, (l.summary || '').slice(0, 110)].filter(Boolean).join(' — ');
}

// The city list with what each is known for, so "the city with the Eiffel
// Tower" or "where the Rocky steps are" lands on the right city.
let cityItems = null;
function getCityItems() {
  if (!cityItems) {
    cityItems = PICKABLE_REGIONS.map((r) => ({
      id: r.id,
      text: [
        [r.name, r.city, r.country].filter(Boolean).join(', '),
        r.tagline,
        `known for ${[...(r.landmarks || [])]
          .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
          .slice(0, 5)
          .map((l) => l.name)
          .join(', ')}`,
      ]
        .filter(Boolean)
        .join(' — '),
    }));
  }
  return cityItems;
}

/** Cities the AI thinks a city search means, beyond `localMatches`. */
export function useSmartCitySearch(query, localMatches, enabled = true) {
  const items = getCityItems();
  const { ids, loading } = useSmartSearch({ query, localCount: localMatches.length, items, enabled });
  const have = new Set(localMatches.map((r) => r.id));
  return {
    cities: ids.map((id) => PICKABLE_REGIONS.find((r) => r.id === id)).filter((r) => r && !have.has(r.id)),
    loading,
  };
}
