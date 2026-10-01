import { getRegion } from '../data/regions';
import { usePersistentState } from '../lib/usePersistentState';

const NEVER_EMPTY = () => false;

const SORTS = [
  { id: 'points', label: 'Points' },
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
];

function fmtDate(seconds) {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Sortable list of cities visited -- shared by Profile's own "Cities you've
// visited" modal and a friend's Cities view in FriendsPanel, both of which
// already have cityIds/cityPoints/cityLastVisit from the same getUserStats
// shape. onSelect is optional (the friend view has nothing to navigate to).
export default function CityList({ cityIds, cityPoints, cityLastVisit, onSelect }) {
  // Remembered across visits -- same choice for your own list and a friend's.
  const [sortBy, setSortBy] = usePersistentState('cities.sort', 'newest', { isEmpty: NEVER_EMPTY });

  const sorted = [...(cityIds || [])].sort((a, b) => {
    if (sortBy === 'points') return (cityPoints?.[b] || 0) - (cityPoints?.[a] || 0);
    if (sortBy === 'oldest') return (cityLastVisit?.[a] || 0) - (cityLastVisit?.[b] || 0);
    return (cityLastVisit?.[b] || 0) - (cityLastVisit?.[a] || 0);
  });

  return (
    <>
      <div className="tabs" style={{ marginBottom: 10 }}>
        {SORTS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`tab-btn ${sortBy === s.id ? 'active' : ''}`} aria-pressed={!!(sortBy === s.id)}
            onClick={() => setSortBy(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {sorted.map((id) => {
        const r = getRegion(id);
        const date = fmtDate(cityLastVisit?.[id]);
        return (
          <div
            key={id}
            className="checkin-row"
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
            onClick={() => onSelect?.(id)}
          >
            <div style={{ flex: 1 }}>
              <div className="checkin-name">{r?.name || id}</div>
              <div className="checkin-sub">
                {r?.country}
                {r?.country && date ? ' · ' : ''}
                {date}
              </div>
            </div>
            <div className="checkin-pts">{cityPoints?.[id] ? `${cityPoints[id].toLocaleString()} pts` : ''}</div>
          </div>
        );
      })}
    </>
  );
}
