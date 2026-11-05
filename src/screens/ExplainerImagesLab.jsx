import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { distanceMeters } from '../lib/geo';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { introPlaces, routeOrder, cityOf, shortName } from '../lib/introPlaces';

// The five-screen intro (Discover, Arrive prepared, Plan Less, Play,
// Remember), live screens instead of pictures; the Game tutorial's 5 images
// step. Discover, Arrive prepared, Plan Less and Remember show New York's
// Statue of Liberty, Central Park and Times Square (lib/introPlaces.js), each
// with a hand-picked vibrant photo. Tapping a landmark opens
// its page (owner, 2026-11-03), with no captions in between. Nothing here is
// saved.
const pagePath = (l) => `/landmarks/${l.regionId || l.region}/${l.id}`;

// Titles and captions word for word from the owner's five images.
const SLIDES = [
  { id: 'discover', title: 'Discover', line: 'Discover places worth visiting.' },
  { id: 'prepared', title: 'Arrive prepared', line: 'Arrive prepared with what to know before you go.' },
  { id: 'plan', title: 'Plan Less', line: 'Explore with a clear route that saves you time.' },
  { id: 'play', title: 'Play', line: 'Compete and share the fun with family and friends.' },
  { id: 'remember', title: 'Remember', line: 'Remember your favorite places and memories organized and in one place.' },
];

// Each place's photo: its hand-picked intro photo (lib/introPlaces.js),
// else its own photos in turn, else a plain tile. A small (c) carries the
// photo's credit, as its license requires.
function Credit({ photo }) {
  if (!photo?.credit) return null;
  const text = `Photo: ${photo.credit}, Wikimedia Commons`;
  return (
    <a
      className="place-photo-credit place-photo-credit-compact"
      href={photo.page}
      target="_blank"
      rel="noopener noreferrer"
      title={text}
      aria-label={text}
      onClick={(e) => e.stopPropagation()}
    >
      {'\u00A9'}
    </a>
  );
}

function Photo({ landmark, className = '', credit = true }) {
  const [skip, setSkip] = useState(0);
  const pick = landmark?.introPhoto;
  const images = [...(pick ? [pick.url] : []), ...(landmark?.images || [])];
  const src = images[skip];
  return (
    <span className={`intro-photo ${className}`}>
      {src ? <img key={src} src={src} alt="" onError={() => setSkip(skip + 1)} /> : null}
      {credit && pick && skip === 0 && <Credit photo={pick} />}
    </span>
  );
}
const photoUrl = (landmark) => landmark?.introPhoto?.url || landmark?.images?.[0] || '';

const Heart = ({ on }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </svg>
);
const Chevron = ({ open }) => (
  <svg className={`intro-chevron${open ? ' open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);
const Pin = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </svg>
);

function Discover({ places }) {
  const navigate = useNavigate();
  const [saved, setSaved] = useState({});
  return (
    <div className="intro-discover">
      {places.map((p, i) => (
        <div key={p.id} className={`intro-place${i === 0 ? ' hero' : ''}`}>
          <button type="button" className="intro-place-body" aria-label={`Open ${p.name}`} onClick={() => navigate(pagePath(p))}>
            <Photo landmark={p} />
            <span className="intro-place-label">
              <span className="intro-place-city">
                <Pin /> {cityOf(p)}
              </span>
              <span className="intro-place-name">{p.name}</span>
            </span>
          </button>
          <button
            type="button"
            className={`intro-heart${saved[p.id] ? ' on' : ''}`}
            aria-pressed={!!saved[p.id]}
            aria-label={saved[p.id] ? `Unsave ${p.name}` : `Save ${p.name}`}
            onClick={() => setSaved((s) => ({ ...s, [p.id]: !s[p.id] }))}
          >
            <Heart on={saved[p.id]} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Prepared({ places }) {
  const navigate = useNavigate();
  const place = places[0];
  const [open, setOpen] = useState(null);
  const [saved, setSaved] = useState(false);
  if (!place) return null;
  // Only rows the place has data for.
  const rows = [
    place.typicalMinutes && { id: 'time', icon: '\u{23F1}\u{FE0F}', title: 'How long it takes', sub: 'Plan your visit around it.', body: `Most visits take about ${place.typicalMinutes} minutes.` },
    place.free != null && { id: 'entry', icon: '\u{1F39F}\u{FE0F}', title: 'Tickets & entry', sub: 'What to sort out ahead of time.', body: place.free ? 'Free to visit.' : 'Tickets needed. Book ahead.' },
    place.facts?.length > 0 && { id: 'story', icon: '\u{1F4D6}', title: 'The story behind it', sub: 'A few facts for the walk over.', body: place.facts },
  ].filter(Boolean);
  return (
    <div className="intro-prepared">
      <button type="button" className="intro-photo-link" aria-label={`Open ${place.name}`} onClick={() => navigate(pagePath(place))}>
        <Photo landmark={place} className="intro-prepared-photo" />
      </button>
      <div className="intro-panel">
        <div className="intro-panel-head">
          <span>
            <span className="intro-panel-title">Before you go</span>
            <span className="intro-panel-sub">{place.name}</span>
          </span>
          <button type="button" className={`intro-icon-btn${saved ? ' on' : ''}`} aria-pressed={saved} aria-label="Save for later" onClick={() => setSaved(!saved)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3h12v18l-6-4-6 4z" />
            </svg>
          </button>
        </div>
        {rows.map((r) => (
          <div key={r.id} className="intro-row-wrap">
            <button type="button" className="intro-row" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span className="intro-row-icon" aria-hidden="true">
                {r.icon}
              </span>
              <span className="intro-row-text">
                <span className="intro-row-title">{r.title}</span>
                <span className="intro-row-sub">{r.sub}</span>
              </span>
              <Chevron open={open === r.id} />
            </button>
            {open === r.id && (
              <div className="intro-row-body">
                {Array.isArray(r.body) ? (
                  <ul>
                    {r.body.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                ) : (
                  r.body
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Plan Less's map: the real map (the Map tab's satellite with labels) with
// the route's stops numbered and a dotted line between them, zoomed to fit.
// It doesn't pan or zoom, so a swipe still moves between the five screens;
// tapping a stop opens its page.
const SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
// Each stop's pin (owner's mockup, 2026-11-03): a round photo of the
// landmark with its number on top and its (short) name under it.
const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// The photo is centered on its stop, so the dotted route runs right into
// each landmark (owner, 2026-11-04); the name sits under it.
const PIN_W = 96;
const PIN_H = 86;
const stopIcon = (n, name, photo) =>
  L.divIcon({
    className: 'intro-map-pin',
    html: `<span class="intro-map-pin-photo"><img src="${photo}" alt="" /></span><span class="intro-map-pin-num">${n}</span><span class="intro-map-pin-name">${escapeHtml(name)}</span>`,
    iconSize: [PIN_W, PIN_H],
    // The photo's center (46px photo, 3px border) on the stop.
    iconAnchor: [PIN_W / 2, 26],
  });
const STILL = { dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomControl: false };

function RouteMap({ stops, onOpen }) {
  const line = stops.map((s) => [s.lat, s.lng]);
  return (
    <MapContainer className="intro-map" bounds={L.latLngBounds(line)} boundsOptions={{ paddingTopLeft: [56, 34], paddingBottomRight: [56, 56] }} zoomSnap={0.1} attributionControl={false} {...STILL}>
      <TileLayer url={SATELLITE} maxZoom={19} />
      <TileLayer url={LABELS} maxZoom={19} zIndex={650} />
      <Polyline positions={line} pathOptions={{ color: '#4d7fff', weight: 4, dashArray: '2 9', lineCap: 'round' }} />
      {stops.map((s, i) => (
        <Marker
          key={s.id}
          position={[s.lat, s.lng]}
          icon={stopIcon(i + 1, shortName(s.name), photoUrl(s))}
          title={s.name}
          eventHandlers={{ click: () => onOpen(s) }}
        />
      ))}
    </MapContainer>
  );
}

function Plan({ places, coords }) {
  const { units } = useUnits();
  const navigate = useNavigate();
  const stops = routeOrder(places, coords);
  const credits = stops.map((st) => st.introPhoto?.credit).filter(Boolean);
  if (stops.length < 2) return null;
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += distanceMeters(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng);
  return (
    <div className="intro-plan">
      <RouteMap stops={stops} onOpen={(st) => navigate(pagePath(st))} />
      {credits.length > 0 && <p className="intro-map-credit">Photos: {credits.join(' · ')} (Wikimedia Commons)</p>}
      <div className="intro-panel">
        <div className="intro-panel-head">
          <span>
            <span className="intro-panel-title">Your route</span>
            <span className="intro-panel-sub">
              {stops.length} stops · {formatDistance(total, units)}
            </span>
          </span>
        </div>
        {stops.map((s, i) => (
          <button key={s.id} type="button" className="intro-stop" aria-label={`Open ${s.name}`} onClick={() => navigate(pagePath(s))}>
            <span className="intro-stop-num">{i + 1}</span>
            <Photo landmark={s} className="intro-stop-photo" credit={false} />
            <span className="intro-row-text">
              <span className="intro-row-title">{s.name}</span>
              {/* Distance to the next stop (owner, 2026-11-05); the same straight-line measure as the total. */}
              {stops[i + 1] && <span className="intro-row-sub">{formatDistance(distanceMeters(s.lat, s.lng, stops[i + 1].lat, stops[i + 1].lng), units)} to next stop</span>}
            </span>
            <Chevron />
          </button>
        ))}
      </div>
    </div>
  );
}

// Play (owner's mockup, 2026-11-03): the owner's photo of friends taking a
// selfie in Times Square, with the "Explore together" card (their three
// faces) over it. The "New place discovered!" toast came off (owner, 2026-11-04).
// Share the fun opens the phone's share sheet.
// New file names whenever the photo changes, so no browser keeps the old one.
const PLAY_PHOTO = '/intro/play-times-square.jpg';
const PLAY_FACES = ['/intro/play-ts-friend-1.jpg', '/intro/play-ts-friend-2.jpg', '/intro/play-ts-friend-3.jpg'];

function Play() {
  const [shared, setShared] = useState(false);
  const share = async () => {
    const text = 'Come explore with me on Landmark Hunters.';
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard?.writeText(text);
    } catch {
      // The person closed the share sheet; nothing to do.
    }
    setShared(true);
  };
  return (
    <div className="intro-play">
      <img className="intro-play-hero" src={PLAY_PHOTO} alt="Friends taking a selfie together in Times Square" />
      <div className="intro-together">
        <div className="intro-together-faces" aria-hidden="true">
          {PLAY_FACES.map((src) => (
            <img key={src} src={src} alt="" />
          ))}
        </div>
        <span className="intro-together-title">Explore together</span>
        <span className="intro-together-stars" aria-label="3 stars">
          {'\u2605\u2605\u2605'}
        </span>
        <button type="button" className="intro-together-share" onClick={share}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
          </svg>
          {shared ? 'Shared' : 'Share the fun'}
        </button>
      </div>
    </div>
  );
}




// Remember's own photos (owner, 2026-11-05): friends' selfies, shown as
// full-width landscape rows. The Statue of Liberty one is cropped 1.6 to 1 so
// the statue and all three faces fit, so its row is a little taller.
const MEMORY_PHOTOS = {
  'statue-of-liberty': { url: '/intro/nyc-statue-friends.jpg', alt: 'Friends taking a selfie together at the Statue of Liberty', tall: true },
  'times-square': { url: PLAY_PHOTO, alt: 'Friends taking a selfie together in Times Square' },
};

function Remember({ places }) {
  const navigate = useNavigate();
  return (
    <div className="intro-remember">
      <div className="intro-panel">
        <div className="intro-panel-head">
          <span className="intro-panel-title">
            <Pin /> Your {cityOf(places[0])} memories
          </span>
          <span className="intro-panel-sub">{places.length} places</span>
        </div>
        <div className="intro-memories">
          {/* Owner, 2026-11-05: one full-width landscape row per place. Statue of
              Liberty and Times Square show the friends' selfies (not the stock
              photos used on the other screens); Central Park keeps its photo. */}
          {places.map((p) => {
            const own = MEMORY_PHOTOS[p.id];
            return (
              <button key={p.id} type="button" className={`intro-memory wide${own?.tall ? ' tall' : ''}`} aria-label={`Open ${p.name}`} onClick={() => navigate(pagePath(p))}>
                {own ? (
                  <span className="intro-photo">
                    <img src={own.url} alt={own.alt} />
                  </span>
                ) : (
                  <Photo landmark={p} />
                )}
                <span className="intro-memory-caption">{p.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const SCREENS = { discover: Discover, prepared: Prepared, plan: Plan, play: Play, remember: Remember };

// onDone(how): set when the intro is one step of a tutorial (Game
// tutorial): Skip ('skipped') and "Start exploring" ('finished') hand off to
// the next step instead of showing the "You're all set" card. onSlide(id)
// hears which screen is showing, so Mapr can talk about it.
// coords (optional): where the user is; Plan Less starts the route at the
// stop closest to them.
export default function ExplainerImagesLab({ onDone = null, onSlide = null, coords = null }) {
  const places = useMemo(() => introPlaces(), []);
  const [index, setIndex] = useState(0);
  const [doneHere, setDone] = useState(false);
  const done = doneHere && !onDone;
  const finish = (how) => (onDone ? onDone(how) : setDone(true));
  const swipeStart = useRef(null);
  const last = SLIDES.length - 1;
  const slide = SLIDES[index];
  const Screen = SCREENS[slide.id];
  const go = (i) => setIndex(Math.max(0, Math.min(last, i)));
  const slideId = slide.id;
  useEffect(() => {
    onSlide?.(slideId);
  }, [slideId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (done) {
    return (
      <div className="card section intro-lab intro-done">
        <img src="/logo.png" alt="" className="intro-logo" />
        <h2 className="intro-title">You're all set</h2>
        <p className="intro-line">Here the real app would open the Map tab.</p>
        <button
          type="button"
          className="btn btn-primary intro-next"
          onClick={() => {
            setDone(false);
            setIndex(0);
          }}
        >
          Watch again
        </button>
      </div>
    );
  }

  return (
    <div
      className="card section intro-lab"
      onPointerDown={(e) => {
        swipeStart.current = e.clientX;
      }}
      onPointerUp={(e) => {
        const dx = swipeStart.current == null ? 0 : e.clientX - swipeStart.current;
        swipeStart.current = null;
        if (Math.abs(dx) > 60) go(index + (dx < 0 ? 1 : -1));
      }}
    >
      <div className="intro-top">
        <span className="intro-brand">
          <img src="/logo.png" alt="" className="intro-logo" />
          Landmark Hunters
        </span>
        <button type="button" className="intro-skip" onClick={() => finish('skipped')}>
          Skip
        </button>
      </div>
      <h2 className="intro-title">{slide.title}</h2>
      <p className="intro-line">{slide.line}</p>
      <div className="intro-screen" key={slide.id}>
        <Screen places={places} coords={coords} />
      </div>
      <div className="intro-dots" role="tablist" aria-label="Screens">
        {SLIDES.map((s, i) => (
          <button key={s.id} type="button" role="tab" aria-selected={i === index} aria-label={s.title} className={`intro-dot${i === index ? ' on' : ''}`} onClick={() => go(i)} />
        ))}
      </div>
      <p className="intro-count">
        {index + 1} of {SLIDES.length}
      </p>
      <div className="intro-nav">
        {index > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => go(index - 1)}>
            Back
          </button>
        )}
        <button type="button" className="btn btn-primary intro-next" onClick={() => (index === last ? finish('finished') : go(index + 1))}>
          {index === last ? 'Start exploring' : 'Next →'}
        </button>
      </div>
    </div>
  );
}
