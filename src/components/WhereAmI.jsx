import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QUICK_CHECKIN_METERS, placesWithin } from '../lib/whereAmI';
import { useCheckIn } from '../lib/useCheckIn';
import { useWhereAmI } from '../lib/useWhereAmI';

// "Where I am", under the header on every tab (owner request 2026-10-14):
// the landmark you're at, else your street address, or "Traveling…" while
// you're moving. Rides down the page with the header like the back
// buttons; it sets --whereami-h to its height, which --header-h adds, so
// back buttons and the Map's buttons move down by it instead of being
// covered. Hidden until there's a location fix.

export default function WhereAmI() {
  const navigate = useNavigate();
  const { user, firebaseEnabled, claimedMap = {}, checkingIn, checkIn } = useCheckIn();
  const ref = useRef(null);
  const [listOpen, setListOpen] = useState(false);
  const { coords, places, here, near, traveling, text } = useWhereAmI();
  const visible = !!coords;

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!visible) {
      root.style.removeProperty('--whereami-h');
      return undefined;
    }
    const set = () => root.style.setProperty('--whereami-h', `${ref.current?.offsetHeight || 0}px`);
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    if (ro && ref.current) ro.observe(ref.current);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--whereami-h');
    };
  }, [visible]);

  if (!visible) return null;

  const place = !traveling ? here?.place || near : null;
  // Check in without opening the place: only within 30 m, and not while
  // you're moving. Same rate + post sheet as everywhere else. Several
  // places that close: a list, the ones you haven't checked into first.
  const checkPlaces =
    firebaseEnabled && user && !traveling ? placesWithin(coords, places, QUICK_CHECKIN_METERS, claimedMap) : [];
  const checkPlace = checkPlaces.length === 1 ? checkPlaces[0] : null;
  const checkLabelFor = (p) =>
    checkingIn === p.id ? '\u{23F3} Checking in…' : claimedMap[p.id] ? 'Check in again' : 'Check in';

  const open = () => {
    const region = place?.regionId || place?.region;
    if (place?.id && region) navigate(`/landmarks/${region}/${place.id}`);
    else navigate('/');
  };

  return (
    <div className="where-am-i-row" ref={ref}>
      <button
        type="button"
        className={`where-am-i${traveling ? ' where-am-i-moving' : ''}`}
        onClick={open}
        aria-live="polite"
        aria-label={traveling ? 'Where you are: traveling' : `Where you are: ${text}`}
      >
        <span aria-hidden="true">{traveling ? '\u{1F697}' : here?.place ? '\u{2B50}' : '\u{1F4CD}'}</span>
        <span className="where-am-i-text">{here?.place && !traveling ? `At ${text}` : text}</span>
      </button>
      {checkPlace && (
        <button
          type="button"
          className="btn btn-primary btn-sm where-am-i-checkin"
          disabled={checkingIn === checkPlace.id}
          aria-busy={checkingIn === checkPlace.id}
          onClick={() => checkIn(checkPlace)}
        >
          {checkingIn === checkPlace.id
            ? checkLabelFor(checkPlace)
            : `\u{1F4CD} ${checkLabelFor(checkPlace)}${checkPlace.id !== here?.place?.id ? ` at ${checkPlace.name}` : ''}`}
        </button>
      )}
      {checkPlaces.length > 1 && (
        <div className="where-am-i-checkin-wrap">
          <button
            type="button"
            className="btn btn-primary btn-sm where-am-i-checkin"
            aria-expanded={listOpen}
            onClick={() => setListOpen((o) => !o)}
          >
            {`\u{1F4CD} Check in \u00B7 ${checkPlaces.length} places here ${listOpen ? '\u25B4' : '\u25BE'}`}
          </button>
          {listOpen && (
            <ul className="where-am-i-list" role="list">
              {checkPlaces.map((p) => (
                <li key={p.id || p.name} className="where-am-i-list-row">
                  <span className="where-am-i-list-name">{p.name}</span>
                  <button
                    type="button"
                    className={`btn btn-sm ${claimedMap[p.id] ? 'btn-success' : 'btn-primary'}`}
                    disabled={checkingIn === p.id}
                    aria-busy={checkingIn === p.id}
                    onClick={() => {
                      setListOpen(false);
                      checkIn(p);
                    }}
                  >
                    {checkLabelFor(p)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
