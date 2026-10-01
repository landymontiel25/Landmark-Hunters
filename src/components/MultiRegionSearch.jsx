import { Fragment, useEffect, useRef, useState } from 'react';
import { PICKABLE_REGIONS } from '../data/regions';
import { matchesSearch } from '../lib/search';
import { useSmartCitySearch } from '../lib/smartSearch';
import SmartSearchLabel from './SmartSearchLabel';

// Same type-to-search box as RegionSearch, but for picking SEVERAL cities at
// once ("Philly or NYC this weekend") instead of one -- built as its own
// component rather than a mode on RegionSearch so that component's other
// callers (TripSetup, Profile's regional leaderboard, CategorySelect) stay
// exactly as they were. Selecting a city here toggles it and keeps the list
// open, since picking more than one is the whole point; selected cities show
// as removable chips below the search box.
export default function MultiRegionSearch({ selectedIds, onToggle, onClearAll, placeholder = 'Add a city…' }) {
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
  const wordMatches = q
    ? sortedRegions.filter((r) => matchesSearch([r.name, r.city, r.country, r.tagline].filter(Boolean).join(' '), q))
    : sortedRegions;
  const smart = useSmartCitySearch(q, wordMatches, open);
  const matches = [...wordMatches, ...smart.cities];
  const selected = sortedRegions.filter((r) => selectedIds.includes(r.id));

  return (
    <div ref={ref}>
      <div className="autocomplete">
        <input
          type="text"
          name="city-search"
          aria-label={placeholder}
          enterKeyHint="search"
          spellCheck={false}
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          // Enter adds the top match, so the keyboard's "search" key does
          // something instead of nothing.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && q && matches.length > 0) {
              e.preventDefault();
              // Enter adds; it never removes a city that is already picked.
              if (!selectedIds.includes(matches[0].id)) onToggle(matches[0]);
              setQuery('');
            }
          }}
          autoComplete="off"
          autoCapitalize="off"
        />
        {open && (matches.length > 0 || smart.loading) && (
          <div className="autocomplete-list">
            {smart.loading && <SmartSearchLabel loading />}
            {matches.map((r, i) => {
              const isSelected = selectedIds.includes(r.id);
              return (
                <Fragment key={r.id}>
                {i === wordMatches.length && <SmartSearchLabel count={smart.cities.length} />}
                <button
                  type="button"
                  className="autocomplete-item"
                  onClick={() => onToggle(r)}
                >
                  <span className="autocomplete-primary">
                    {isSelected ? `${'\u{2713}'} ` : ''}
                    {r.name}
                  </span>
                  {r.tagline && <span className="autocomplete-secondary">{r.tagline}</span>}
                </button>
                </Fragment>
              );
            })}
          </div>
        )}
        {open && q && matches.length === 0 && !smart.loading && (
          <div className="autocomplete-list">
            <p className="city-dropdown-empty">No cities match.</p>
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {selected.map((r) => (
            <button
              type="button"
              key={r.id}
              className="tag tag-active"
              style={{ cursor: 'pointer', fontFamily: 'inherit', appearance: 'none' }}
              onClick={() => onToggle(r)}
              title="Remove"
            >
              {r.name} {'\u{2715}'}
            </button>
          ))}
          <button
            type="button"
            className="tag"
            style={{ cursor: 'pointer', fontFamily: 'inherit', appearance: 'none' }}
            onClick={onClearAll}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
