import { useRef, useState } from 'react';
import { ALL_LANDMARKS } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import { nearestLandmarks } from '../lib/nearestLandmarks';
import { useUnits, formatDistance } from '../lib/UnitsContext';

// Test tab: "5 images". The five-screen intro the owner drew (Discover,
// Arrive prepared, Plan less, Play, Remember), built as live screens instead
// of pictures. Every card, row, stop and photo responds to a tap; Next, Back
// (swipe), the dots and Skip move between screens. It uses real Philly
// landmarks and their own photos and facts. Nothing here is saved.
const byId = (id) => ALL_LANDMARKS.find((l) => l.id === id);

const DISCOVER = ['independence-hall', 'liberty-bell-center', 'reading-terminal-market'];
const PREPARED = 'independence-hall';
const ROUTE = ['independence-hall', 'reading-terminal-market', 'philadelphia-museum-of-art'];
const PLAY = 'independence-hall';
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
const FRIENDS = [
  { initials: 'You', color: '#4d7fff' },
  { initials: 'SR', color: '#9b5cf6' },
  { initials: 'AK', color: '#55c987' },
];

const SLIDES = [
  { id: 'discover', title: 'Discover', line: 'Find places worth the trip, picked for you.' },
  { id: 'prepared', title: 'Arrive prepared', line: 'Know what to expect before you go.' },
  { id: 'plan', title: 'Plan less', line: 'Mapr lines your stops up into one route.' },
  { id: 'play', title: 'Play', line: 'Check in, earn points, and explore with friends.' },
  { id: 'remember', title: 'Remember', line: 'Every place you visit, kept in one spot.' },
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
  const [saved, setSaved] = useState({});
  const [open, setOpen] = useState(null);
  const places = DISCOVER.map(byId).filter(Boolean);
  return (
    <div className="intro-discover">
      {places.map((p, i) => (
        <div key={p.id} className={`intro-place${i === 0 ? ' hero' : ''}${open === p.id ? ' open' : ''}`}>
          <button type="button" className="intro-place-body" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
            <Photo landmark={p} />
            {i === 0 && <span className="intro-chip">Picked for you</span>}
            <span className="intro-place-label">
              <span className="intro-place-city">
                <Pin /> Philadelphia
              </span>
              <span className="intro-place-name">{p.name}</span>
              {open === p.id && <span className="intro-place-summary">{p.summary}</span>}
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
      <Photo landmark={place} className="intro-prepared-photo" />
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

// Lays the route's real coordinates onto a small map box.
function project(stops, w, h, pad) {
  const lats = stops.map((s) => s.lat);
  const lngs = stops.map((s) => s.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  return stops.map((s) => ({
    x: pad + ((s.lng - minLng) / (maxLng - minLng || 1)) * (w - pad * 2),
    y: pad + ((maxLat - s.lat) / (maxLat - minLat || 1)) * (h - pad * 2),
  }));
}

function Plan() {
  const { units } = useUnits();
  const [active, setActive] = useState(0);
  const stops = ROUTE.map(byId).filter(Boolean);
  if (stops.length < 2) return null;
  const pts = project(stops, 320, 150, 28);
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += distanceMeters(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng);
  return (
    <div className="intro-plan">
      <svg className="intro-map" viewBox="0 0 320 150" role="img" aria-label="Route map">
        {Array.from({ length: 12 }, (_, i) => (
          <line key={`v${i}`} x1={i * 28} y1="0" x2={i * 28} y2="150" />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={i * 28} x2="320" y2={i * 28} />
        ))}
        <polyline className="intro-map-route" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />
        {pts.map((p, i) => (
          <g key={stops[i].id} className={`intro-map-stop${active === i ? ' on' : ''}`} onClick={() => setActive(i)}>
            <circle cx={p.x} cy={p.y} r={active === i ? 13 : 10} />
            <text x={p.x} y={p.y + 4}>
              {i + 1}
            </text>
          </g>
        ))}
      </svg>
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
          <button key={s.id} type="button" className={`intro-stop${active === i ? ' on' : ''}`} aria-pressed={active === i} onClick={() => setActive(i)}>
            <span className="intro-stop-num">{i + 1}</span>
            <Photo landmark={s} className="intro-stop-photo" />
            <span className="intro-row-text">
              <span className="intro-row-title">{s.name}</span>
              {active === i && <span className="intro-row-sub">About {s.typicalMinutes} min here</span>}
            </span>
            <Chevron />
          </button>
        ))}
      </div>
    </div>
  );
}

// Within this many metres of a landmark counts as being at it.
const AT_PLACE_M = 100;

function Play() {
  const { units } = useUnits();
  const [checkedIn, setCheckedIn] = useState(false);
  const [shared, setShared] = useState(false);
  // Check in looks up where you are: you are at a landmark, or here is how
  // far the closest ones are. { status: 'locating' | 'ready' | 'denied', list }
  const [nearby, setNearby] = useState(null);
  const here = nearby?.status === 'ready' && nearby.list[0]?.meters <= AT_PLACE_M ? nearby.list[0].landmark : null;
  const place = here || byId(PLAY);
  const checkIn = () => {
    if (!navigator.geolocation) {
      setNearby({ status: 'denied', list: [] });
      return;
    }
    setNearby({ status: 'locating', list: [] });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const list = nearestLandmarks({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 3);
        setNearby({ status: 'ready', list });
        if (list[0]?.meters <= AT_PLACE_M) setCheckedIn(true);
      },
      () => setNearby({ status: 'denied', list: [] }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };
  const share = async () => {
    const text = `I just checked in at ${place.name} on Landmark Hunters.`;
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
      <Photo landmark={place} index={2} className="intro-play-photo" />
      {checkedIn && (
        <div className="intro-toast" role="status">
          <Photo landmark={place} className="intro-toast-photo" />
          New place discovered!
          <span className="intro-toast-check" aria-hidden="true">
            {'✓'}
          </span>
        </div>
      )}
      <div className="intro-panel intro-play-panel">
        <div className="intro-avatars" aria-label="You and 2 friends">
          {FRIENDS.map((f) => (
            <span key={f.initials} className="intro-avatar" style={{ background: f.color }}>
              {f.initials}
            </span>
          ))}
        </div>
        <span className="intro-panel-title">Explore together</span>
        <span className="intro-panel-sub">{place.name}</span>
        <div className="intro-play-actions">
          <button
            type="button"
            className={`btn ${checkedIn ? 'btn-ghost' : 'btn-primary'}`}
            disabled={checkedIn || nearby?.status === 'locating'}
            onClick={checkIn}
          >
            {checkedIn ? 'Checked in' : nearby?.status === 'locating' ? 'Finding you…' : '\u{1F4CD} Check in'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={share}>
            {shared ? 'Shared' : 'Share the fun'}
          </button>
        </div>
        {nearby?.status === 'denied' && (
          <p className="intro-nearby" role="status">
            Turn on location to see the landmark closest to you.
          </p>
        )}
        {nearby?.status === 'ready' && (
          <div className="intro-nearby" role="status">
            {nearby.list.length === 0 ? (
              <p>No landmarks found near you.</p>
            ) : here ? (
              <p>
                You are at <strong>{here.name}</strong>.
              </p>
            ) : (
              <>
                <p>
                  Closest landmark: <strong>{nearby.list[0].landmark.name}</strong>, {formatDistance(nearby.list[0].meters, units)} away.
                </p>
                {nearby.list.length > 1 && (
                  <p className="intro-nearby-more">
                    Then {nearby.list.slice(1).map((n) => `${n.landmark.name} (${formatDistance(n.meters, units)})`).join(', ')}.
                  </p>
                )}
              </>
            )}
          </div>
        )}
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
  const places = MEMORIES.map(([id, photo]) => ({ place: byId(id), photo })).filter((m) => m.place);
  const [big, setBig] = useState(null);
  const shown = big && places.find((m) => m.place.id === big);
  return (
    <div className="intro-remember">
      <div className="intro-panel">
        <div className="intro-panel-head">
          <span className="intro-panel-title">
            <Pin /> Your Philly memories
          </span>
          <span className="intro-panel-sub">{places.length} places</span>
        </div>
        {shown ? (
          <button type="button" className="intro-memory-big" onClick={() => setBig(null)} aria-label="Close photo">
            <Photo landmark={shown.place} index={shown.photo} />
            <span className="intro-memory-caption">{shown.place.name}</span>
          </button>
        ) : (
          <div className="intro-memories">
            {places.map(({ place: p, photo }, i) => (
              <button key={p.id} type="button" className={`intro-memory${i === 0 ? ' wide' : ''}`} aria-label={`Open ${p.name}`} onClick={() => setBig(p.id)}>
                <Photo landmark={p} index={photo} />
                <span className="intro-memory-caption">{p.name}</span>
              </button>
            ))}
          </div>
        )}
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

export default function ExplainerImagesLab() {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const swipeStart = useRef(null);
  const last = SLIDES.length - 1;
  const slide = SLIDES[index];
  const Screen = SCREENS[slide.id];
  const go = (i) => setIndex(Math.max(0, Math.min(last, i)));

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
        <button type="button" className="intro-skip" onClick={() => setDone(true)}>
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
        <button type="button" className="btn btn-primary intro-next" onClick={() => (index === last ? setDone(true) : go(index + 1))}>
          {index === last ? 'Start exploring' : 'Next →'}
        </button>
      </div>
    </div>
  );
}
