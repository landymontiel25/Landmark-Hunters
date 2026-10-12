import { Fragment, useEffect, useRef, useState } from 'react';
import { PICKABLE_REGIONS, getRegion, regionSearchText } from '../data/regions';
import { scopeRows } from '../lib/cityScope';
import { matchesSearch } from '../lib/search';
import { useSmartCitySearch } from '../lib/smartSearch';
import SmartSearchLabel from './SmartSearchLabel';

export const ANY_REGION = { id: '', name: 'Any region', tagline: 'Search everywhere' };

// Type-to-search region picker (not a card list to tap through, not a plain
// <select> to scroll) -- matches the "type where you are" ask. `region` is
// the currently selected region object (or a placeholder with just a name).
// `towns`: also offer the towns inside a city (Miami in South Florida); a
// picked town comes back as its city with `townKey` (a lib/cityScope key) and
// the town's name.
export default function RegionSearch({ region, onSelect, includeAny = false, towns = false, placeholder = 'Search for a region…' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const sortedRegions = [...PICKABLE_REGIONS].sort((a, b) => a.name.localeCompare(b.name));
  const options = includeAny ? [ANY_REGION, ...sortedRegions] : sortedRegions;
  const townMatches = towns && q
    ? scopeRows(q, { withAll: false })
        .filter((row) => row.key.startsWith('a:'))
        .map((row) => {
          const city = getRegion(row.key.split(':')[1]);
          return { ...city, townKey: row.key, name: row.primary, tagline: city.name };
        })
    : [];
  const wordMatches = q
    ? [...townMatches, ...options.filter((r) => matchesSearch(regionSearchText(r), q))]
    : options;
  const smart = useSmartCitySearch(q, wordMatches, open);
  const matches = [...wordMatches, ...smart.cities];

  return (
    <div className="autocomplete" ref={ref}>
      <input
        type="text"
        name="region-search"
        aria-label={placeholder}
        enterKeyHint="search"
        spellCheck={false}
        placeholder={placeholder}
        value={open ? query : region?.name || ''}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onChange={(e) => setQuery(e.target.value)}
        // Enter picks the top match, so the keyboard's "search" key works.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && open && q && matches.length > 0) {
            e.preventDefault();
            onSelect(matches[0]);
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
        autoComplete="off"
        autoCapitalize="off"
      />
      {open && (matches.length > 0 || smart.loading) && (
        <div className="autocomplete-list">
          {smart.loading && <SmartSearchLabel loading />}
          {matches.map((r, i) => (
            <Fragment key={r.townKey || r.id || 'any'}>
            {i === wordMatches.length && <SmartSearchLabel count={smart.cities.length} />}
            <button
              type="button"
              className="autocomplete-item"
              onClick={() => {
                onSelect(r);
                setOpen(false);
              }}
            >
              <span className="autocomplete-primary">{r.name}</span>
              {r.tagline && <span className="autocomplete-secondary">{r.tagline}</span>}
            </button>
            </Fragment>
          ))}
        </div>
      )}
      {open && q && matches.length === 0 && !smart.loading && (
        <div className="autocomplete-list">
          <p className="city-dropdown-empty">No cities match.</p>
        </div>
      )}
    </div>
  );
}
