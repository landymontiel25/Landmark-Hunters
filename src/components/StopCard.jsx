import { useId, useState } from 'react';
import CheckInButton from './CheckInButton';
import DirectionsButton from './DirectionsButton';
import LandmarkThumb from './LandmarkThumb';
import RatingsSection from './ratings/RatingsSection';
import { bookingHref, costLine, timeLine } from '../lib/stopCard';

// One stop on an itinerary (owner, 2026-11-14). Only this, in this order:
// a big photo, the name, the buttons (Get directions, Check in, Book now),
// then "Show more". Show more opens, top first: whether it's free to visit
// or costs money, how long you'll spend there, and the place's Google
// reviews, which load only when you open it (each lookup is billed).
// Everything else that used to sit on the card is gone; removing the stop
// moved to the bottom of Show more.

export default function StopCard({ stop, visited, photo, onOpen, onDirectionsInApp, onRemove, checkIn }) {
  const [open, setOpen] = useState(false);
  // Mounted on the first open and kept, so closing and reopening doesn't
  // look the reviews up again.
  const [opened, setOpened] = useState(false);
  const panelId = useId();
  const book = stop.external ? null : bookingHref(stop);
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
      <h4 className="it-stop-name">
        <button type="button" onClick={onOpen}>
          {stop.name}
        </button>
      </h4>
      <div className="it-stop-actions">
        <DirectionsButton name={stop.name} lat={stop.lat} lng={stop.lng} className="btn btn-ghost btn-sm" onInApp={onDirectionsInApp}>
          Get directions
        </DirectionsButton>
        {!stop.external && checkIn && <CheckInButton landmark={stop} plain {...checkIn} />}
        {book && (
          <a className="btn btn-ghost btn-sm" href={book} target="_blank" rel="noreferrer">
            Book now
          </a>
        )}
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
                <li>{stop.external ? 'Might cost money. Check before you go.' : costLine(stop)}</li>
                {time && <li>{time}</li>}
              </ul>
              {stop.external
                ? stop.url && (
                    <a className="it-stop-source" href={stop.url} target="_blank" rel="noreferrer">
                      Source {'↗'}
                    </a>
                  )
                : <RatingsSection landmark={stop} />}
              <button type="button" className="it-stop-remove" onClick={onRemove}>
                Remove from trip
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
