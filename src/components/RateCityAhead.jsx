import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ALL_LANDMARKS } from '../data/regions';
import { useCheckIn } from '../lib/useCheckIn';
import { useRatings } from '../lib/RatingsContext';
import { isRateable } from '../lib/ratingFlow';
import RegionSearch from './RegionSearch';

// Second "+" tile in "Your Mapr Picks", next to RateLandmarkSearch -- that
// one is name-first ("I know it's called the Louvre"), this one is
// city-first: pick a city you're planning to visit and rate whatever you
// already have an opinion on by reputation alone, before you've ever set
// foot there. Same ratingOnly check-in RateLandmarkSearch uses underneath
// (a real rating, 0 points, no visit claimed), just browsed by city instead
// of searched by name -- useful for "I know I'll love the art museums here,
// I just don't know their names yet." Every rating feeds that city's tag
// scores exactly like any other (see tagScores.js/api/mapr-picks.js), so
// Mapr can already have a shortlist ready before you land, not just after
// your first few check-ins there.
//
// Unlike RateLandmarkSearch (closes after one pick), this stays open after
// each rating -- prepping a city usually means rating several in a row, and
// closing after every tap would make that tedious.
export default function RateCityAhead() {
  const { checkIn, user } = useCheckIn();
  const { myReviews } = useRatings();
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState(null);

  if (!user) return null;

  const openPicker = () => {
    setRegion(null);
    setOpen(true);
  };
  const close = () => setOpen(false);

  const landmarks = region ? ALL_LANDMARKS.filter((l) => l.regionId === region.id && isRateable(l)) : [];

  return (
    <>
      <button type="button" className="mapr-pick mapr-pick-add" onClick={openPicker}>
        <span className="mapr-pick-add-plus" aria-hidden="true">
          {'\u{1F30D}'}
        </span>
        <span className="mapr-pick-add-label">Prep a Trip</span>
        <span className="mapr-pick-add-sub">Rate a city ahead of time</span>
      </button>
      {open &&
        createPortal(
          <div className="modal-backdrop" onClick={close}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0 }}>{'\u{1F30D}'} Rate a City Ahead of Time</h3>
              <p className="screen-subtitle" style={{ marginTop: 0 }}>
                Going somewhere new? Pick the city and rate whatever you already have a feel for -- a landmark you know
                you'd love, a museum you know you'd skip. Mapr builds picks for that city from it before you even land.
              </p>
              <RegionSearch region={region} onSelect={setRegion} placeholder="Search for a city you're visiting…" />
              {region && (
                <div
                  className="autocomplete-list"
                  style={{ position: 'static', marginTop: 10, boxShadow: 'none', maxHeight: 360, overflowY: 'auto' }}
                >
                  {landmarks.length === 0 && (
                    <p className="screen-subtitle" style={{ margin: '8px 0' }}>Nothing to rate in {region.name} yet.</p>
                  )}
                  {landmarks.map((l) => {
                    const alreadyRated = !!myReviews[l.id];
                    return (
                      <button
                        type="button"
                        key={l.id}
                        className="autocomplete-item"
                        onClick={() => checkIn(l, { requireComment: true, ratingOnly: true })}
                        disabled={alreadyRated}
                      >
                        <span className="autocomplete-primary">{l.name}</span>
                        <span className="autocomplete-secondary">
                          {alreadyRated ? `${'\u{2713}'} Already rated` : l.categories?.[0] || ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 14 }} onClick={close}>
                Done
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
