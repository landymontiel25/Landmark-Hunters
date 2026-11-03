import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ALL_LANDMARKS } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import { useUnits, formatDistance } from '../lib/UnitsContext';

// Test tab: "5 images". The five-screen intro the owner drew (Discover,
// Arrive prepared, Plan Less, Play, Remember), built as live screens instead
// of pictures. Every card, row, stop and photo responds to a tap; Next, Back
// (swipe), the dots and Skip move between screens. It uses real Philly
// landmarks and their own photos and facts. Nothing here is saved.
const byId = (id) => ALL_LANDMARKS.find((l) => l.id === id);
// Tapping a landmark anywhere in the intro opens its page (owner,
// 2026-11-03): no descriptions or captions in between.
const pagePath = (l) => `/landmarks/${l.regionId || l.region}/${l.id}`;

const DISCOVER = ['independence-hall', 'liberty-bell-center', 'reading-terminal-market'];
const PREPARED = 'independence-hall';
const ROUTE = ['independence-hall', 'reading-terminal-market', 'philadelphia-museum-of-art'];
// [landmark, which of its photos]
const MEMORIES = [
  ['independence-hall', 0],
  ['reading-terminal-market', 2],
  ['liberty-bell-center', 0],
];
// "Other travelers" tiles on the Remember screen: drawn scenes, not photos.
// To use real pictures, give an entry a `photo` URL (a file under /public);
// the tile then shows that image instead of the drawing.
const TRAVELERS = [
  { name: 'Maya', place: 'Independence Hall', sky: ['#f6b26b', '#ffe5b4'], skin: '#8d5524', shirt: '#4d7fff', hair: '#2b1b12', shape: 'tower' },
  { name: 'Jordan & Ellis', place: 'Reading Terminal Market', sky: ['#7aa7ff', '#cfe0ff'], skin: '#e0ac69', shirt: '#e5603d', hair: '#5a3825', shape: 'arch', two: true },
  { name: 'Priya', place: 'Museum of Art steps', sky: ['#9b8cf6', '#e3dcff'], skin: '#c68642', shirt: '#55c987', hair: '#120c08', shape: 'columns' },
  { name: 'Sam', place: 'Liberty Bell Center', sky: ['#5fc7c0', '#d5f3f0'], skin: '#f1c27d', shirt: '#9b5cf6', hair: '#c9a24d', shape: 'bell' },
];

// Titles and captions word for word from the owner's five images.
const SLIDES = [
  { id: 'discover', title: 'Discover', line: 'Discover places worth visiting.' },
  { id: 'prepared', title: 'Arrive prepared', line: 'Arrive prepared with what to know before you go.' },
  { id: 'plan', title: 'Plan Less', line: 'Explore with a clear route that saves you time.' },
  { id: 'play', title: 'Play', line: 'Play and share the fun with family and friends.' },
  { id: 'remember', title: 'Remember', line: 'Remember your favorite places and memories organized and in one place.' },
];

// A photo that fails to load falls through to the landmark's next one,
// then to a plain tile.
function Photo({ landmark, index = 0, className = '' }) {
  const [skip, setSkip] = useState(0);
  const images = landmark?.images || [];
  const src = images[(index + skip) % (images.length || 1)];
  return (
    <span className={`intro-photo ${className}`}>
      {src && skip < images.length ? <img key={src} src={src} alt="" onError={() => setSkip(skip + 1)} /> : null}
    </span>
  );
}

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

function Discover() {
  const navigate = useNavigate();
  const [saved, setSaved] = useState({});
  const places = DISCOVER.map(byId).filter(Boolean);
  return (
    <div className="intro-discover">
      {places.map((p, i) => (
        <div key={p.id} className={`intro-place${i === 0 ? ' hero' : ''}`}>
          <button type="button" className="intro-place-body" aria-label={`Open ${p.name}`} onClick={() => navigate(pagePath(p))}>
            <Photo landmark={p} />
            {i === 0 && <span className="intro-chip">Picked for you</span>}
            <span className="intro-place-label">
              <span className="intro-place-city">
                <Pin /> Philadelphia
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

function Prepared() {
  const navigate = useNavigate();
  const place = byId(PREPARED);
  const [open, setOpen] = useState(null);
  const [saved, setSaved] = useState(false);
  if (!place) return null;
  const rows = [
    { id: 'time', icon: '⏱️', title: 'How long it takes', sub: 'Plan your visit around it.', body: `Most visits take about ${place.typicalMinutes} minutes.` },
    { id: 'entry', icon: '\u{1F39F}️', title: 'Tickets & entry', sub: 'What to sort out ahead of time.', body: place.free ? 'Free to visit.' : 'Tickets needed. Book ahead.' },
    { id: 'story', icon: '\u{1F4D6}', title: 'The story behind it', sub: 'A few facts for the walk over.', body: place.facts },
  ];
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
// landmark with its number on top and its name under it. The photos are
// saved in public/intro (route-1..3.jpg, from Wikimedia Commons, credited
// under the map) so the pins never wait on a lookup.
const ROUTE_PHOTOS = ['/intro/route-1.jpg', '/intro/route-2.jpg', '/intro/route-3.jpg'];
const ROUTE_CREDIT = 'Photos: Rdsmith4, Bruce Andersen, ExNihilo01 (CC BY-SA), Wikimedia Commons';
const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Short map labels, so they fit at phone width.
const ROUTE_LABELS = { 'reading-terminal-market': 'Reading Terminal', 'philadelphia-museum-of-art': 'Museum of Art' };
// The photo sits above its stop's dot, or below it, alternating, so stops
// close together (Independence Hall, Reading Terminal) don't cover each other.
const PIN_W = 96;
const PIN_H = 86;
const stopIcon = (n, name, photo, above) =>
  L.divIcon({
    className: `intro-map-pin ${above ? 'above' : 'below'}`,
    html: `<span class="intro-map-pin-photo"><img src="${photo}" alt="" /></span><span class="intro-map-pin-num">${n}</span><span class="intro-map-pin-name">${escapeHtml(name)}</span>`,
    iconSize: [PIN_W, PIN_H],
    iconAnchor: above ? [PIN_W / 2, PIN_H + 4] : [PIN_W / 2, -6],
  });
const STILL = { dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomControl: false };

function RouteMap({ stops, onOpen }) {
  const line = stops.map((s) => [s.lat, s.lng]);
  return (
    <MapContainer className="intro-map" bounds={L.latLngBounds(line)} boundsOptions={{ paddingTopLeft: [60, 24], paddingBottomRight: [60, 100] }} attributionControl={false} {...STILL}>
      <TileLayer url={SATELLITE} maxZoom={19} />
      <TileLayer url={LABELS} maxZoom={19} zIndex={650} />
      <Polyline positions={line} pathOptions={{ color: '#4d7fff', weight: 4, dashArray: '2 9', lineCap: 'round' }} />
      {stops.map((s) => (
        <CircleMarker key={`dot-${s.id}`} center={[s.lat, s.lng]} radius={5} pathOptions={{ color: '#fff', weight: 2, fillColor: '#2f6bff', fillOpacity: 1 }} />
      ))}
      {stops.map((s, i) => (
        <Marker
          key={s.id}
          position={[s.lat, s.lng]}
          icon={stopIcon(i + 1, ROUTE_LABELS[s.id] || s.name, ROUTE_PHOTOS[i], i % 2 === 1)}
          title={s.name}
          eventHandlers={{ click: () => onOpen(s) }}
        />
      ))}
    </MapContainer>
  );
}

function Plan() {
  const { units } = useUnits();
  const navigate = useNavigate();
  const stops = ROUTE.map(byId).filter(Boolean);
  if (stops.length < 2) return null;
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += distanceMeters(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng);
  return (
    <div className="intro-plan">
      <RouteMap stops={stops} onOpen={(st) => navigate(pagePath(st))} />
      <p className="intro-map-credit">{ROUTE_CREDIT}</p>
      <div className="intro-panel">
        <div className="intro-panel-head">
          <span>
            <span className="intro-panel-title">Your route</span>
            <span className="intro-panel-sub">
              {stops.length} stops · {formatDistance(total, units)} of walking
            </span>
          </span>
        </div>
        {stops.map((s, i) => (
          <button key={s.id} type="button" className="intro-stop" aria-label={`Open ${s.name}`} onClick={() => navigate(pagePath(s))}>
            <span className="intro-stop-num">{i + 1}</span>
            <img className="intro-stop-photo" src={ROUTE_PHOTOS[i]} alt="" />
            <span className="intro-row-text">
              <span className="intro-row-title">{s.name}</span>
            </span>
            <Chevron />
          </button>
        ))}
      </div>
    </div>
  );
}

// Play (owner's mockup, 2026-11-03): the owner's photo of friends taking a
// selfie at the Colosseum, with "New place discovered!" (the Colosseum) and
// the "Explore together" card (their three faces) over it.
// Share the fun opens the phone's share sheet.
// New file names whenever the photo changes, so no browser keeps the old one.
const PLAY_PHOTO = '/intro/play-colosseum.jpg';
const PLAY_PLACE = '/intro/play-colosseum-place.jpg';
const PLAY_FACES = ['/intro/play-friend-1.jpg', '/intro/play-friend-2.jpg', '/intro/play-friend-3.jpg'];

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
      <img className="intro-play-hero" src={PLAY_PHOTO} alt="Friends taking a selfie together at the Colosseum" />
      <div className="intro-toast">
        <img className="intro-toast-photo" src={PLAY_PLACE} alt="" />
        New place discovered!
        <span className="intro-toast-check" aria-hidden="true">
          {'\u2713'}
        </span>
      </div>
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

function Person({ x, skin, shirt, hair }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <rect x="-13" y="82" width="26" height="38" rx="11" fill={shirt} />
      <circle cx="0" cy="68" r="12" fill={skin} />
      <path d="M-12 66a12 12 0 0 1 24 0c-5-5-17-5-24 0z" fill={hair} />
    </g>
  );
}

function Backdrop({ shape }) {
  const c = 'rgba(40,48,70,0.55)';
  if (shape === 'tower')
    return (
      <g fill={c}>
        <rect x="52" y="52" width="76" height="68" />
        <rect x="80" y="26" width="20" height="30" />
        <path d="M78 26l12-16 12 16z" />
      </g>
    );
  if (shape === 'arch')
    return (
      <g fill={c}>
        <rect x="24" y="56" width="132" height="64" />
        <path d="M70 120v-26a20 20 0 0 1 40 0v26z" fill="rgba(255,255,255,0.35)" />
      </g>
    );
  if (shape === 'columns')
    return (
      <g fill={c}>
        <path d="M30 56l60-20 60 20z" />
        {[44, 68, 92, 116, 140].map((x) => (
          <rect key={x} x={x - 4} y="58" width="8" height="62" />
        ))}
      </g>
    );
  return (
    <g fill={c}>
      <rect x="40" y="60" width="100" height="60" />
      <path d="M90 28a22 22 0 0 1 22 22v10H68V50a22 22 0 0 1 22-22z" />
    </g>
  );
}

function TravelerTile({ t }) {
  const id = `sky-${t.name.replace(/\W/g, '')}`;
  return (
    <figure className="intro-traveler">
      {t.photo ? (
        <img className="intro-traveler-art" src={t.photo} alt={`${t.name} at ${t.place}`} />
      ) : (
        <svg className="intro-traveler-art" viewBox="0 0 180 120" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Drawing of ${t.name} at ${t.place}`}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={t.sky[0]} />
              <stop offset="1" stopColor={t.sky[1]} />
            </linearGradient>
          </defs>
          <rect width="180" height="120" fill={`url(#${id})`} />
          <Backdrop shape={t.shape} />
          <Person x={t.two ? 76 : 90} skin={t.skin} shirt={t.shirt} hair={t.hair} />
          {t.two && <Person x={106} skin="#f1c27d" shirt="#f2b705" hair="#3b2a1a" />}
        </svg>
      )}
      <figcaption className="intro-memory-caption">
        {t.name} · {t.place}
      </figcaption>
    </figure>
  );
}

function Remember() {
  const navigate = useNavigate();
  const places = MEMORIES.map(([id, photo]) => ({ place: byId(id), photo })).filter((m) => m.place);
  return (
    <div className="intro-remember">
      <div className="intro-panel">
        <div className="intro-panel-head">
          <span className="intro-panel-title">
            <Pin /> Your Philly memories
          </span>
          <span className="intro-panel-sub">{places.length} places</span>
        </div>
        <div className="intro-memories">
          {places.map(({ place: p, photo }, i) => (
            <button key={p.id} type="button" className={`intro-memory${i === 0 ? ' wide' : ''}`} aria-label={`Open ${p.name}`} onClick={() => navigate(pagePath(p))}>
              <Photo landmark={p} index={photo} />
              <span className="intro-memory-caption">{p.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="intro-panel">
        <div className="intro-panel-head">
          <span className="intro-panel-title">
            <Pin /> Shared by other travelers
          </span>
          <span className="intro-panel-sub">examples</span>
        </div>
        <div className="intro-memories">
          {TRAVELERS.map((t) => (
            <TravelerTile key={t.name} t={t} />
          ))}
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
export default function ExplainerImagesLab({ onDone = null, onSlide = null }) {
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
        <Screen />
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
