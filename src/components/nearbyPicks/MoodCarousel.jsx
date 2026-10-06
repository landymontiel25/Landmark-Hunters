import { useMemo, useState } from 'react';
import { MOODS, MOOD_SORTS, moodPlaces } from '../../lib/nearbyPicks';
import { useReadyItems } from './useNearbyPicks';
import { useShownEffect } from './useShownEffect';
import PickCard, { PickRow } from './PickCard';
import DirectionsButton from '../DirectionsButton';

// Carousel (swipe sideways) or list (scroll a short box up and down). The
// choice is remembered on this device.
export const VIEW_KEY = 'lh.moodView';
const VIEWS = [
  { id: 'carousel', label: 'Carousel' },
  { id: 'list', label: 'List' },
];
function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'carousel';
  } catch {
    return 'carousel';
  }
}

// "What are you in the mood for?": swipe through moods, pick one, then
// swipe its places (or scroll them as a list), sorted closest or highest
// rated. `pool` is
// nearbyPicks.eligiblePlaces (already inside the distance filter).
// rank(places) is Mapr's ranking for the "For you" sort (MapPicksOverlay
// passes maprRank/surfaces.js rankPlaces); without it, For you is closest.
// onShown(places) is called with the places on screen (logged as picks).
export default function MoodCarousel({ pool, ratings, initialMood = null, initialSort = 'foryou', moods = MOODS, rank = null, onShown = null }) {
  const [mood, setMood] = useState(initialMood);
  const [sort, setSort] = useState(initialSort);
  const [view, setViewState] = useState(readView);
  const setView = (v) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode: the choice lasts until the page reloads */
    }
  };
  const places = useMemo(() => {
    if (!mood) return [];
    if (sort !== 'foryou' || !rank) return moodPlaces({ moodId: mood, pool, sort: sort === 'foryou' ? 'closest' : sort, ratings, limit: 12, moods });
    return rank(moodPlaces({ moodId: mood, pool, sort: 'closest', ratings, limit: 60, moods })).slice(0, 12);
  }, [mood, pool, sort, ratings, moods, rank]);
  const ready = useReadyItems(places, 8);
  useShownEffect(onShown, ready);

  return (
    <section className="mpp-section">
      <h3 className="mpp-section-title">What are you in the mood for?</h3>
      <div className="mpp-carousel mpp-moods" role="listbox" aria-label="Moods">
        {moods.map((m) => (
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
          <div className="mpp-sort-row">
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
            <div className="mpp-view-toggle" role="radiogroup" aria-label="View">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={view === v.id}
                  className={view === v.id ? 'active' : ''}
                  onClick={() => setView(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          {ready.length ? (
            view === 'list' ? (
              <ul className="mpp-rows mpp-mood-list" aria-label="Places">
                {ready.map((p) => (
                  <PickRow
                    key={`${p.region}/${p.id}`}
                    pick={p}
                    action={
                      <DirectionsButton name={p.name} lat={p.lat} lng={p.lng} className="btn btn-ghost btn-sm">
                        Directions
                      </DirectionsButton>
                    }
                  />
                ))}
              </ul>
            ) : (
              <div className="mpp-carousel">
                {ready.map((p) => (
                  <PickCard key={`${p.region}/${p.id}`} pick={p} showTag={false} />
                ))}
              </div>
            )
          ) : (
            <p className="mpp-note">{places.length ? 'Loading places…' : 'Nothing for that mood within your distance.'}</p>
          )}
        </>
      )}
    </section>
  );
}
