import { useEffect, useId, useState } from 'react';
import CheckInButton from './CheckInButton';
import DirectionsButton from './DirectionsButton';
import LandmarkThumb from './LandmarkThumb';
import RatingsSection from './ratings/RatingsSection';
import GoogleAttribution from './ratings/GoogleAttribution';
import { useLandmarkRatings } from '../lib/useLandmarkRatings';
import { hasRating } from '../lib/ratingSources';
import { costLine, descriptionLine, fallbackWhy, timeLine } from '../lib/stopCard';
import { loadWhyGo, whyKey } from '../lib/whyGoApi';
import { missionOf } from '../lib/missions';
import { StarIcon, TargetIcon } from './HeadingIcons';

// One stop on an itinerary (owner, 2026-11-14, 2026-11-15). In this order:
// a big photo; the name with its Google rating beside it (or "New" when
// Google has none); a super short description; the buttons (Get directions,
// Check in; Book now removed, owner 2026-11-16); then "Show more". Show more
// opens, top first: Free or Needs a ticket, "Time Spent: ~x hr/min",
// the place's "Mission:" when it has one (the Abacos, owner 2026-11-16),
// "Why you need to go" (three lines from Mapr, written from the place's
// own data, api/why-go.js), the place's Google reviews (loaded only when
// you open it; each lookup is billed), and Remove from trip.

// "★ 4.6" next to the name. Google's rating only, with Google's credit as
// its rules require; "New" only when Google says it has none. Nothing while
// it loads, when signed out, or if the lookup fails: never a made-up number.
function StopRating({ stop }) {
  const { ref, status, sources } = useLandmarkRatings(stop, { enabled: !stop.external });
  const google = status === 'done' && hasRating(sources.google) ? sources.google : null;
  return (
    <span ref={ref} className="it-stop-rating">
      {google ? (
        <>
          <span aria-label={`Rated ${google.rating.toFixed(1)} out of 5 on Google`}>
            <span aria-hidden="true">{'★'}</span> {google.rating.toFixed(1)}
          </span>
          <GoogleAttribution />
        </>
      ) : status === 'done' && sources.googleNoRating ? (
        <span className="it-stop-new">New</span>
      ) : null}
    </span>
  );
}

function WhyGo({ stop, batch }) {
  const key = whyKey(stop);
  // A place found on the web has no catalog data to write from: the honest
  // lines straight away.
  const [lines, setLines] = useState(() => (stop.external ? fallbackWhy(stop) : null));
  useEffect(() => {
    let live = true;
    if (stop.external) return undefined;
    loadWhyGo(batch?.length ? batch : [stop]).then((m) => {
      if (live) setLines(m[key] || fallbackWhy(stop));
    });
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the stop is captured by its key
  return (
    <section className="it-stop-why" aria-label="Why you need to go" aria-busy={!lines}>
      <h5>
        <StarIcon />
        Why you need to go
      </h5>
      <ul>
        {(lines || [0, 1, 2]).map((l, i) =>
          lines ? (
            <li key={i}>{l}</li>
          ) : (
            <li key={i} className="it-stop-why-wait" aria-hidden="true">
              <span />
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

export default function StopCard({ stop, visited, photo, onOpen, onDirectionsInApp, onRemove, checkIn, batch }) {
  const [open, setOpen] = useState(false);
  // Mounted on the first open and kept, so closing and reopening doesn't
  // look anything up again.
  const [opened, setOpened] = useState(false);
  const panelId = useId();
  const time = timeLine(stop);
  const toggle = () => {
    setOpen((o) => !o);
    setOpened(true);
  };

  return (
    <div className={`card it-stop ${visited ? 'visited' : ''}`}>
      <button type="button" className="it-stop-photo" onClick={onOpen} aria-label={`Open ${stop.name}`}>
        <LandmarkThumb landmark={stop} size={640} myPhoto={photo} />
      </button>
      <div className="it-stop-head">
        <h4 className="it-stop-name">
          <button type="button" onClick={onOpen}>
            {stop.name}
          </button>
        </h4>
        <StopRating stop={stop} />
      </div>
      <p className="it-stop-desc">{descriptionLine(stop)}</p>
      <div className="it-stop-actions">
        <DirectionsButton name={stop.name} lat={stop.lat} lng={stop.lng} className="btn btn-ghost btn-sm" onInApp={onDirectionsInApp}>
          Get directions
        </DirectionsButton>
        {!stop.external && checkIn && <CheckInButton landmark={stop} plain {...checkIn} />}
        {/* Opens the place's full page (owner, 2026-11-19). */}
        <button type="button" className="btn btn-ghost btn-sm it-stop-info" onClick={onOpen} aria-label={`Info for ${stop.name}`}>
          Info
        </button>
      </div>
      <button type="button" className="it-stop-more" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
        <span>{open ? 'Show less' : 'Show more'}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div className="it-stop-panel" id={panelId} data-open={open ? 'true' : undefined} inert={!open}>
        <div className="it-stop-panel-inner">
          {opened && (
            <>
              <ul className="it-stop-facts">
                <li>{stop.external ? 'Might need a ticket' : costLine(stop)}</li>
                {time && <li>{time}</li>}
              </ul>
              {/* "Why you need to go" before Mission (owner, 2026-11-19). */}
              <WhyGo stop={stop} batch={batch} />
              {missionOf(stop) && (
                <section className="it-stop-mission" aria-label="Mission">
                  <h5>
                    <TargetIcon />
                    Mission:
                  </h5>
                  <p>{missionOf(stop).text}</p>
                </section>
              )}
              {stop.external
                ? stop.url && (
                    <a className="it-stop-source" href={stop.url} target="_blank" rel="noreferrer">
                      Source {'↗'}
                    </a>
                  )
                : <RatingsSection landmark={stop} />}
              {/* A place not on the trip yet (Add Landmarks) has nothing to remove. */}
              {onRemove && (
                <button type="button" className="it-stop-remove" onClick={onRemove}>
                  Remove from trip
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
