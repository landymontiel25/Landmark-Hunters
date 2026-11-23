// The itinerary's sort (owner, 2026-11-23): three choices, always shown,
// and every switch re-sorts the list (routing.js orderStops).
export const ITINERARY_SORTS = [
  { id: 'nearest', label: 'Nearest to Me' },
  { id: 'optimized', label: 'Optimized Route' },
  { id: 'custom', label: 'My Order' },
];
export const DEFAULT_ITINERARY_SORT = 'optimized';
export const itinerarySortLabel = (id) => ITINERARY_SORTS.find((s) => s.id === id)?.label || 'Optimized Route';
// A remembered choice from before these three existed ('route' was the
// optimized chain; the old 'nearest' was too) reads as Optimized Route.
export const normalizeItinerarySort = (v) => (v === 'nearest' || v === 'optimized' || v === 'custom' ? v : DEFAULT_ITINERARY_SORT);

export default function ItinerarySort({ value, onChange, disabled = false }) {
  return (
    <div className="tabs nl-seg itin-sort-seg" role="group" aria-label="Sort the stops">
      {ITINERARY_SORTS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`tab-btn ${value === s.id ? 'active' : ''}`}
          aria-pressed={value === s.id}
          disabled={disabled}
          onClick={() => onChange(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
