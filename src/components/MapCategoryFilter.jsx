import { useState } from 'react';
import { INTERESTS } from '../data/regions';
import { matchesSearch } from '../lib/search';

// Categories hidden from this filter for now. Their landmarks still show
// on the map under "All landmarks"; remove an id here to bring it back.
const HIDDEN_CATEGORIES = new Set(['formula-1', 'benches']);
const FILTER_INTERESTS = INTERESTS.filter((i) => !HIDDEN_CATEGORIES.has(i.id));

// The map's category filter: one solid control naming what's showing
// ("All landmarks", one category, or "3 categories"). Tapping it drops
// down a searchable list; tap rows to add or remove categories.
export default function MapCategoryFilter({ selected, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const only = selected.size === 1 ? FILTER_INTERESTS.find((i) => selected.has(i.id)) : null;
  const label =
    selected.size === 0 ? (
      <>
        <span className="chip-icon">{'\u{1F4CD}'}</span> All landmarks
      </>
    ) : only ? (
      <>
        <span className="chip-icon">{only.icon}</span> {only.label}
      </>
    ) : (
      `${selected.size} categories`
    );
  const shown = FILTER_INTERESTS.filter((i) => matchesSearch(i.label, query));

  return (
    <div className="map-cat-filter">
      <button
        type="button"
        className="map-cat-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="map-cat-trigger-label">{label}</span>
        <span aria-hidden="true">{open ? '\u{25B4}' : '\u{25BE}'}</span>
      </button>
      {open && (
        <div className="map-search-results map-cat-list">
          <input
            type="search"
            className="map-cat-search"
            aria-label="Search categories"
            placeholder={'\u{1F50D} Search categories'}
            autoComplete="off"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div role="listbox" aria-multiselectable="true">
            {!query.trim() && (
              <button
                type="button"
                role="option"
                aria-selected={selected.size === 0}
                className="map-search-result map-cat-row"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
              >
                <span>
                  <span className="chip-icon">{'\u{1F4CD}'}</span> All landmarks
                </span>
                {selected.size === 0 && <span className="map-cat-check">{'\u{2713}'}</span>}
              </button>
            )}
            {shown.map((i) => (
              <button
                key={i.id}
                type="button"
                role="option"
                aria-selected={selected.has(i.id)}
                className="map-search-result map-cat-row"
                onClick={() => onToggle(i.id)}
              >
                <span>
                  <span className="chip-icon">{i.icon}</span> {i.label}
                </span>
                {selected.has(i.id) && <span className="map-cat-check">{'\u{2713}'}</span>}
              </button>
            ))}
            {shown.length === 0 && <div className="map-search-empty">No category matches “{query}”.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
