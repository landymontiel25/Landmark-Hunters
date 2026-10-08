import { useEffect, useRef, useState } from 'react';
import { INTERESTS, PICKABLE_INTERESTS } from '../data/regions';
import { matchesSearch } from '../lib/search';

// Type-to-search category picker for Add Landmark, the same control as the
// city picker (RegionSearch). One category per landmark. `value` is the
// selected category id (or '').
export default function CategorySelect({ value, onSelect, placeholder = 'Search for a category…' }) {
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

  const selected = INTERESTS.find((i) => i.id === value) || null;
  const q = query.trim().toLowerCase();
  const matches = q ? PICKABLE_INTERESTS.filter((i) => matchesSearch(i.label, q)) : PICKABLE_INTERESTS;

  return (
    <div className="autocomplete" ref={ref}>
      <input
        type="text"
        name="category"
        aria-label="Category"
        enterKeyHint="search"
        spellCheck={false}
        placeholder={placeholder}
        value={open ? query : selected ? `${selected.icon} ${selected.label}` : ''}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        autoCapitalize="off"
      />
      {open && matches.length > 0 && (
        <div className="autocomplete-list">
          {matches.map((i) => (
            <button
              type="button"
              key={i.id}
              className="autocomplete-item"
              onClick={() => {
                onSelect(i.id);
                setOpen(false);
              }}
            >
              <span className="autocomplete-primary">
                {i.icon} {i.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
