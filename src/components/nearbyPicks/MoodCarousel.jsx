import { useMemo, useState } from 'react';
import { MOODS, MOOD_SORTS, moodPlaces } from '../../lib/nearbyPicks';
import { useReadyItems } from './useNearbyPicks';
import PickCard from './PickCard';

// "What are you in the mood for?": swipe through moods, pick one, then
// swipe its places, sorted closest or highest rated. `pool` is
// nearbyPicks.eligiblePlaces (already inside the distance filter).
export default function MoodCarousel({ pool, ratings, initialMood = null, initialSort = 'closest' }) {
  const [mood, setMood] = useState(initialMood);
  const [sort, setSort] = useState(initialSort);
  const places = useMemo(() => (mood ? moodPlaces({ moodId: mood, pool, sort, ratings, limit: 12 }) : []), [mood, pool, sort, ratings]);
  const ready = useReadyItems(places, 8);

  return (
    <section className="mpp-section">
      <h3 className="mpp-section-title">What are you in the mood for?</h3>
      <div className="mpp-carousel mpp-moods" role="listbox" aria-label="Moods">
        {MOODS.map((m) => (
          <button
            key={m.id}
            type="button"
            role="option"
            aria-selected={mood === m.id}
            className={`mpp-mood ${mood === m.id ? 'active' : ''}`}
            onClick={() => setMood(mood === m.id ? null : m.id)}
          >
            <span className="mpp-mood-icon">{m.icon}</span>
            {m.label}
          </button>
        ))}
      </div>
      {mood && (
        <>
          <div className="mpp-sort" role="radiogroup" aria-label="Sort">
            {MOOD_SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={sort === s.id}
                className={`mpp-chip ${sort === s.id ? 'active' : ''}`}
                onClick={() => setSort(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {ready.length ? (
            <div className="mpp-carousel">
              {ready.map((p) => (
                <PickCard key={`${p.region}/${p.id}`} pick={p} showTag={false} />
              ))}
            </div>
          ) : (
            <p className="mpp-note">{places.length ? 'Loading places…' : 'Nothing for that mood within your distance.'}</p>
          )}
        </>
      )}
    </section>
  );
}
