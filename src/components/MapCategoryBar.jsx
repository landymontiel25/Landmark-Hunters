import { PICKABLE_INTERESTS } from '../data/regions';

// The Map's category bar (owner, 2026-11-07): the Map opens with nothing
// chosen and no pins; you pick "Select All" or one or more category emojis
// at the top. Signed in, it sits in the picks sheet above "Discover popular
// landmarks" (className map-cat-bar-sheet; owner, 2026-11-08), else over
// the map. `value` is null (nothing yet), 'all', or a list of category
// ids. MapExplore keeps it in session state, so it holds while you switch
// tabs and resets when the app is closed.
export default function MapCategoryBar({ value, onChange, className = '' }) {
  const all = value === 'all';
  const picked = Array.isArray(value) ? value : [];
  const toggle = (id) => {
    // From Select All, an emoji narrows to just that category.
    if (all) return onChange([id]);
    const next = picked.includes(id) ? picked.filter((c) => c !== id) : [...picked, id];
    onChange(next.length ? next : null);
  };
  const needsPick = value == null;
  const inSheet = className.includes('map-cat-bar-sheet');
  return (
    <>
    {inSheet && (
      <p className={`map-cat-prompt ${needsPick ? 'needs-pick' : ''}`} role={needsPick ? 'status' : undefined}>
        {needsPick ? 'Choose Select All or a category to see places on the map' : 'Swipe up for picks near you'}
      </p>
    )}
    <div className={`map-cat-bar ${className} ${needsPick ? 'needs-pick' : ''}`.trim()} role="group" aria-label="Show on the map">
      <button type="button" className={`map-cat-chip map-cat-all ${all ? 'on' : ''}`} aria-pressed={all} onClick={() => onChange(all ? null : 'all')}>
        Select All
      </button>
      {PICKABLE_INTERESTS.map((i) => {
        const on = all || picked.includes(i.id);
        return (
          <button
            key={i.id}
            type="button"
            className={`map-cat-chip ${on ? 'on' : ''}`}
            aria-pressed={on}
            aria-label={i.label}
            title={i.label}
            onClick={() => toggle(i.id)}
          >
            <span aria-hidden="true">{i.icon}</span>
          </button>
        );
      })}
    </div>
    </>
  );
}

// Whether a landmark shows for the bar's value.
export function passesMapCategories(value, landmark) {
  if (value === 'all') return true;
  if (!Array.isArray(value) || !value.length) return false;
  return (landmark.categories || []).some((c) => value.includes(c));
}
