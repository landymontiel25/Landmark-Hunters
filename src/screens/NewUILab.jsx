import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ALL_LANDMARKS, INTERESTS } from '../data/regions';
import { ensurePlacePacks, usePlacePacksVersion } from '../lib/placePacks';
import { NAV_ITEMS } from '../components/BottomNav';
import { SPRING, Spring, VelocityTracker, project, rubberband } from './newUISpring';
import './NewUILab.css';

// The real Mapr tab, exactly as it is in the app (owner, 2026-11-14).
const Mapr = lazy(() => import('./Mapr'));
// The real Map tab, exactly as it is in the app: satellite view, blue pins,
// green once checked in (owner, 2026-11-14).
const LiveMap = lazy(() => import('./MapExplore'));
// The app's real header (logo, streak, points, @username), kept as it is
// and floating over the New UI (owner, 2026-11-14).
const Header = lazy(() => import('../components/Header'));

// Test tab: "New UI", rebuilt with Apple's Human Interface Guidelines
// (apple-look skill) and Apple's motion rules (apple-motion skill), in
// the design language of docs/design-language.md: white, Inter, gold as
// the only accent, squircles (owner, 2026-11-14).
//
// Same structure as before: the full bottom tab bar (Map, Landmarks,
// Mapr, Itinerary, Profile), every tab its own full screen. Map and Mapr
// are the live tabs, unchanged. Landmarks, Itinerary and Profile each keep
// their own navigation stack, like an iOS tab: a place, trip or row pushes
// in from the right, swipe from the left edge (or Back) to go back, tap
// the current tab to return to its top. "Plan a trip" opens a sheet with a
// medium and a large detent that you can drag and flick. Every motion is a
// spring that starts from where things are on screen, so it can be grabbed
// mid-flight. Places are the real Miami catalog; trips, points and the
// "why you" lines are samples. Nothing here is saved.

// The app's own bottom tabs with their emojis (owner, 2026-11-14); Mapr's
// is the gold pin logo in a squircle with a sparkle (MaprTabIcon).
const TAB_IDS = { Map: 'map', Landmarks: 'landmarks', Mapr: 'mapr', Itinerary: 'itinerary', Profile: 'profile' };
const TABS = NAV_ITEMS.map((n) => ({ id: TAB_IDS[n.label], label: n.label, icon: n.icon }));
const STACK_TABS = ['landmarks', 'itinerary', 'profile'];
const LIVE_TABS = new Set(['map', 'mapr']);

const CITY = { id: 'miami', name: 'Miami' };
const HIDE_KINDS = new Set(['airports', 'benches']);
// Sample: the places "found" so far, as many as this of the best known ones.
const SAMPLE_FOUND = 12;
const SAMPLE_PROFILE = { name: 'You', handle: '@you', points: 1240, checkins: 12, streak: 3 };
const SAMPLE_TASTE = ['history-culture', 'parks-nature', 'food'];

const labelOf = (id) => INTERESTS.find((i) => i.id === id)?.label || 'Places';
const kindOf = (l) => l.categories?.[0];
const minutes = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
// The sample "why you" line (a real build reads Mapr's own reason).
const whyFor = (l, i) =>
  SAMPLE_TASTE.includes(kindOf(l)) ? `Because you like ${labelOf(kindOf(l)).toLowerCase()}` : i % 2 ? 'Found by people like you' : 'Near places you saved';

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

// The real Miami places (bundled + imported packs), with a photo, best known first.
function useCityPlaces() {
  const version = usePlacePacksVersion();
  useEffect(() => {
    ensurePlacePacks();
  }, []);
  return useMemo(() => {
    const all = ALL_LANDMARKS.filter((l) => (l.regionId || l.region) === CITY.id && Number.isFinite(l.lat) && !HIDE_KINDS.has(kindOf(l)));
    const sorted = [...all].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    return { all: sorted, withPhoto: sorted.filter((l) => l.images?.length) };
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps -- recount when a place pack lands
}

// ---------- Small parts ----------

function Icon({ d, size = 18, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={`nui-icon ${className}`}>
      {d}
    </svg>
  );
}
const SEARCH = (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  </>
);
const CHEVRON = <path d="m9 6 6 6-6 6" />;
const BACK = <path d="m15 5-7 7 7 7" />;
const CLEAR = <path d="M8 8l8 8M16 8l-8 8" />;
const CHECK = <path d="m5 12.5 4.5 4.5L19 7.5" />;

function MaprSpark({ size = 18 }) {
  return (
    <svg className="nui-spark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2c.9 5.6 3.4 8.2 10 10-6.6 1.8-9.1 4.4-10 10-.9-5.6-3.4-8.2-10-10 6.6-1.8 9.1-4.4 10-10z" />
    </svg>
  );
}

function MaprLine({ children }) {
  return (
    <div className="nui-mapr" role="note" aria-label="Mapr">
      <MaprSpark />
      <p>{children}</p>
    </div>
  );
}

function Photo({ place, className }) {
  const [broken, setBroken] = useState(false);
  const src = place.images?.[0];
  return <span className={`nui-photo ${className}`}>{src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : null}</span>;
}

function ProgressRing({ found, total, size = 56, count = true }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  return (
    <div className="nui-ring" style={{ width: size, height: size }} role="img" aria-label={`${found} of ${total} found`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="nui-ring-track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="nui-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, found / total))} />
      </svg>
      {count && (
        <span>
          <strong>{found}</strong>/{total}
        </span>
      )}
    </div>
  );
}

// A pill that slides to the selected item ([data-on="true"]) on a
// critically damped spring. A second tap mid-slide retargets from where
// the pill is, so it never jumps.
function useSlidingPill(wrapRef, pillRef, key) {
  const spring = useRef(null);
  const place = (animate) => {
    const wrap = wrapRef.current;
    const pill = pillRef.current;
    const on = wrap?.querySelector('[data-on="true"]');
    if (!pill) return;
    if (!on) {
      pill.style.opacity = '0';
      return;
    }
    pill.style.opacity = '';
    pill.style.width = `${on.offsetWidth}px`;
    pill.style.height = `${on.offsetHeight}px`;
    pill.style.top = `${on.offsetTop}px`;
    if (!spring.current) spring.current = new Spring(on.offsetLeft, (x) => (pill.style.transform = `translateX(${x}px)`));
    if (animate) spring.current.to(on.offsetLeft, SPRING.tab);
    else spring.current.set(on.offsetLeft);
  };
  const placeRef = useRef(place);
  useLayoutEffect(() => {
    placeRef.current = place;
  });
  useLayoutEffect(() => {
    placeRef.current(spring.current != null);
  }, [key]);
  // When the control itself changes size (full screen, a hidden tab shown
  // again), jump the pill into place; a real selection change animates.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined;
    let width = wrap.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (wrap.offsetWidth === width) return;
      width = wrap.offsetWidth;
      placeRef.current(false);
    });
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      spring.current?.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- refs are stable
}

// Segmented control: one choice of a few (HIG: at most about five on
// iPhone, equal widths, nouns).
function Segmented({ label, options, value, onChange }) {
  const wrap = useRef(null);
  const pill = useRef(null);
  useSlidingPill(wrap, pill, value);
  return (
    <div className="nui-seg" role="radiogroup" aria-label={label} ref={wrap}>
      <span className="nui-seg-pill" ref={pill} aria-hidden="true" />
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} data-on={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// The way back on a pushed screen, besides the edge swipe (HIG: offer an
// on-screen alternative to every gesture).
function BackBar({ label, onBack }) {
  return (
    <button type="button" className="nui-backbar" onClick={onBack} aria-label={`Back to ${label}`}>
      <Icon d={BACK} size={20} />
      <span>{label}</span>
    </button>
  );
}

// ---------- Navigation stack (one per tab) ----------

// The root screen plus every pushed screen, as layers. The top layer is
// driven by one number, p (1 = fully in, 0 = gone to the right). Push
// springs p from 0 to 1; Back springs it to 0. Dragging from the left
// edge sets p 1:1 with the finger, and on release the flick's projected
// landing point decides back or stay, with the finger's speed handed to
// the spring so there's no seam.
function StackView({ root, rootLabel, stack, render, onPop }) {
  const box = useRef(null);
  const layers = useRef([]);
  const drag = useRef(null);
  const n = stack.length + 1;

  const apply = useCallback(
    (p) => {
      const w = box.current?.clientWidth || 390;
      for (let i = 0; i < n; i++) {
        const el = layers.current[i];
        if (!el) continue;
        const dim = el.lastElementChild;
        if (i === n - 1) {
          el.style.transform = n > 1 ? `translate3d(${(1 - p) * w}px,0,0)` : '';
          el.style.visibility = '';
          if (dim) dim.style.opacity = '0';
        } else if (i === n - 2) {
          // The screen underneath slides a third as far and dims, as on iOS.
          el.style.transform = `translate3d(${-0.3 * p * w}px,0,0)`;
          el.style.visibility = p >= 1 ? 'hidden' : '';
          if (dim) dim.style.opacity = String(p * 0.12);
        } else {
          el.style.visibility = 'hidden';
        }
      }
    },
    [n],
  );
  const applyRef = useRef(apply);
  useLayoutEffect(() => {
    applyRef.current = apply;
  });
  const [motion] = useState(() => new Spring(1, (p) => applyRef.current(p)));

  const prevN = useRef(n);
  useLayoutEffect(() => {
    const before = prevN.current;
    prevN.current = n;
    if (n > before) {
      motion.set(0);
      motion.to(1, SPRING.push);
    } else {
      motion.set(1);
    }
  }, [n, motion]);
  useEffect(() => () => motion.stop(), [motion]);

  const back = useCallback(() => {
    if (n < 2) return;
    motion.to(0, { ...SPRING.push, done: onPop });
  }, [n, onPop, motion]);

  const onPointerDown = (e) => {
    if (n < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const r = box.current.getBoundingClientRect();
    if (e.clientX - r.left > 28) return;
    const v = new VelocityTracker();
    v.add(e.clientX, e.clientY, e.timeStamp);
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, v, w: r.width };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    d.v.add(e.clientX, e.clientY, e.timeStamp);
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.on) {
      // 10 px before committing to a direction; vertical means scroll.
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null;
        return;
      }
      if (dx < 10) return;
      d.on = true;
      d.start = dx;
      box.current.setPointerCapture?.(e.pointerId);
      // Grab it wherever it is, even mid-push.
      motion.stop();
      d.p0 = motion.value;
    }
    motion.set(Math.min(1, Math.max(0, d.p0 - (dx - d.start) / d.w)));
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.on || e.pointerId !== d.id) return;
    const vx = d.v.get().x;
    const p = motion.value;
    const landing = p - project(vx) / d.w;
    const velocity = -vx / d.w;
    if (landing < 0.5) motion.to(0, { ...SPRING.push, velocity, done: onPop });
    else motion.to(1, { ...SPRING.push, velocity });
  };

  const labels = [rootLabel, ...stack.map((s) => s.title)];
  return (
    <div className="nui-stack" ref={box} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {[null, ...stack].map((entry, i) => (
        <div
          key={entry ? entry.key : 'root'}
          ref={(el) => (layers.current[i] = el)}
          className={`nui-layer ${i > 0 ? 'nui-layer-pushed' : ''}`}
          style={i === n - 1 && n > 1 ? { transform: 'translate3d(100%,0,0)' } : undefined}
          aria-hidden={i < n - 1 ? true : undefined}
          inert={i < n - 1}
        >
          <div className="nui-scroll" data-top={i === n - 1 ? 'true' : undefined}>
            {entry ? render(entry, back, labels[i - 1]) : root}
          </div>
          <div className="nui-dim" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}

// ---------- Place ----------

function PlaceScreen({ place, why, onBack, backLabel }) {
  const [added, setAdded] = useState(false);
  const sourced = (place.facts || []).filter((f) => place.factSources?.[f]).slice(0, 3);
  return (
    <div className="nui-screen-flush">
      <div className="nui-hero">
        <Photo place={place} className="nui-hero-photo" />
        <button type="button" className="nui-hero-back" onClick={onBack} aria-label={`Back to ${backLabel}`}>
          <Icon d={BACK} size={20} />
        </button>
        <div className="nui-hero-text">
          <p className="nui-hero-area">{place.neighborhood || labelOf(kindOf(place))}</p>
          <h1 className="nui-hero-title">{place.name}</h1>
        </div>
      </div>
      <div className="nui-pad">
        <p className="nui-meta">
          {labelOf(kindOf(place))}
          {place.typicalMinutes ? ` · about ${minutes(place.typicalMinutes)}` : ''}
        </p>
        <MaprLine>{why}. It fits in an afternoon, and I can put it on your day.</MaprLine>
        <div className="nui-actions">
          <button type="button" className={`nui-btn-primary ${added ? 'is-done' : ''}`} aria-pressed={added} onClick={() => setAdded((a) => !a)}>
            {added && <Icon d={CHECK} size={18} />}
            {added ? 'Added to trip' : 'Add to trip'}
          </button>
          <a className="nui-btn" href={`https://maps.apple.com/?daddr=${place.lat},${place.lng}`} target="_blank" rel="noreferrer">
            Directions
          </a>
        </div>
        {sourced.length > 0 && (
          <section className="nui-section">
            <p className="nui-label">Facts</p>
            {sourced.map((f) => (
              <div key={f} className="nui-fact">
                <p>{f}</p>
                <a href={place.factSources[f]} target="_blank" rel="noreferrer" className="nui-source">
                  Source: {hostOf(place.factSources[f])}
                </a>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

// ---------- Landmarks ----------

const SORTS = [
  { id: 'for-you', label: 'For you' },
  { id: 'nearby', label: 'Nearby' },
  { id: 'az', label: 'A–Z' },
];

function PlaceRow({ place, why, onOpen }) {
  return (
    <li>
      <button type="button" className="nui-row" onClick={() => onOpen(place, why)}>
        <Photo place={place} className="nui-thumb" />
        <span className="nui-row-text">
          <span className="nui-row-title">{place.name}</span>
          <span className="nui-meta">
            {place.neighborhood || labelOf(kindOf(place))}
            {place.typicalMinutes ? ` · ${minutes(place.typicalMinutes)}` : ''}
          </span>
          {why && <span className="nui-why">{why}</span>}
        </span>
        <Icon d={CHEVRON} size={16} className="nui-chev" />
      </button>
    </li>
  );
}

function LandmarksScreen({ places, onOpen }) {
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('for-you');
  const [query, setQuery] = useState('');
  const kinds = useMemo(() => {
    const counts = {};
    for (const l of places.withPhoto) counts[kindOf(l)] = (counts[kindOf(l)] || 0) + 1;
    return INTERESTS.filter((i) => counts[i.id]).map((i) => i.id);
  }, [places]);
  const q = query.trim().toLowerCase();
  // HIG: search as people type, across every kind of place.
  let list = places.withPhoto.filter((l) => (q ? l.name.toLowerCase().includes(q) : kind === 'all' || kindOf(l) === kind));
  if (sort === 'az') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'nearby') list = [...list].sort((a, b) => a.lat - b.lat);
  return (
    <div className="nui-screen">
      <p className="nui-label">
        {CITY.name} · {places.all.length.toLocaleString('en-US')} places
      </p>
      <h1 className="nui-title">Landmarks</h1>
      <div className="nui-search" role="search">
        <Icon d={SEARCH} size={17} />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${CITY.name} places`} aria-label="Search places" enterKeyHint="search" autoComplete="off" />
        {query && (
          <button type="button" className="nui-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
            <Icon d={CLEAR} size={14} />
          </button>
        )}
      </div>
      {!q && (
        <div className="nui-chips" role="group" aria-label="Kind of place">
          {['all', ...kinds].map((k) => (
            <button key={k} type="button" className={`nui-chip ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === 'all' ? 'All' : labelOf(k)}
            </button>
          ))}
        </div>
      )}
      <div className="nui-gap-top">
        <Segmented label="Sort" options={SORTS} value={sort} onChange={setSort} />
      </div>
      {list.length ? (
        <ul className="nui-list">
          {list.slice(0, 40).map((p) => (
            <PlaceRow key={p.id} place={p} why={whyFor(p, places.withPhoto.indexOf(p))} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <div className="nui-empty">
          <p className="nui-row-title">No places match “{query.trim()}”</p>
          <p className="nui-meta">Try part of the name, like “park” or “museum”.</p>
        </div>
      )}
    </div>
  );
}

// ---------- Itinerary ----------

function sampleTrips(places) {
  return [
    { id: 'weekend', name: `${CITY.name} weekend`, when: 'Nov 21 – 23', stops: places.withPhoto.slice(3, 8) },
    { id: 'beach', name: 'South Beach morning', when: 'Saved', stops: places.withPhoto.slice(8, 11) },
  ];
}

const tripLength = (t) => minutes(t.stops.reduce((m, s) => m + (s.typicalMinutes || 45), 0));

function ItineraryScreen({ places, onOpen, onOpenTrip, onPlan }) {
  const day = places.withPhoto.slice(0, 3);
  const found = 2;
  const walk = ['', '12 min walk', '25 min by bus'];
  return (
    <div className="nui-screen">
      <p className="nui-label">Today · {CITY.name}</p>
      <div className="nui-title-row">
        <h1 className="nui-title">Itinerary</h1>
        <ProgressRing found={found} total={day.length || 1} />
      </div>
      {day.length > 2 && <MaprLine>One stop left. {day[2].name} is next, and it closes out your day.</MaprLine>}
      <ol className="nui-stops">
        {day.map((p, i) => (
          <li key={p.id} className="nui-stop">
            {walk[i] && <p className="nui-walk">{walk[i]}</p>}
            <button type="button" className="nui-row nui-stop-row" onClick={() => onOpen(p, whyFor(p, i))}>
              <span className={`nui-stop-num ${i < found ? 'found' : ''}`}>{i < found ? <Icon d={CHECK} size={14} /> : i + 1}</span>
              <span className="nui-stop-time">{['9:30', '12:15', '2:00'][i]}</span>
              <span className="nui-row-text">
                <span className="nui-row-title">{p.name}</span>
                <span className="nui-meta">{i < found ? 'Checked in' : p.neighborhood || labelOf(kindOf(p))}</span>
              </span>
              <Icon d={CHEVRON} size={16} className="nui-chev" />
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="nui-btn-primary nui-wide" onClick={onPlan} aria-haspopup="dialog">
        Plan a trip
      </button>

      <section className="nui-section">
        <h2 className="nui-h2">Your trips</h2>
        <ul className="nui-list nui-list-flush">
          {sampleTrips(places).map((t) => (
            <li key={t.id}>
              <button type="button" className="nui-row nui-trip" onClick={() => onOpenTrip(t)}>
                <span className="nui-trip-photos" aria-hidden="true">
                  {t.stops.slice(0, 3).map((s) => (
                    <Photo key={s.id} place={s} className="nui-trip-photo" />
                  ))}
                </span>
                <span className="nui-row-text">
                  <span className="nui-row-title">{t.name}</span>
                  <span className="nui-meta">
                    {t.when} · {t.stops.length} places · about {tripLength(t)}
                  </span>
                </span>
                <Icon d={CHEVRON} size={16} className="nui-chev" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function TripScreen({ trip, onOpen, onBack, backLabel }) {
  return (
    <div className="nui-screen nui-screen-pushed">
      <BackBar label={backLabel} onBack={onBack} />
      <p className="nui-label">{trip.when}</p>
      <h1 className="nui-title">{trip.name}</h1>
      <p className="nui-meta nui-gap-top">
        {trip.stops.length} places · about {tripLength(trip)}
      </p>
      <ul className="nui-list">
        {trip.stops.map((p, i) => (
          <PlaceRow key={p.id} place={p} why={whyFor(p, i)} onOpen={onOpen} />
        ))}
      </ul>
    </div>
  );
}

// ---------- Profile ----------

const PROFILE_ROWS = ['My memories', 'Full stats', 'Ranks', 'Leaderboard', 'Friends', 'Settings'];

function ProfileScreen({ places, onOpenPage }) {
  const p = SAMPLE_PROFILE;
  const total = places.all.length;
  return (
    <div className="nui-screen">
      <div className="nui-profile-head">
        <span className="nui-avatar" aria-hidden="true">
          {p.name[0]}
        </span>
        <div>
          <h1 className="nui-title nui-title-sm">{p.handle}</h1>
          <p className="nui-meta">Landmark Hunter</p>
        </div>
      </div>
      <div className="nui-stats" role="group" aria-label="Your numbers">
        {[
          [p.points.toLocaleString('en-US'), 'Points'],
          [p.checkins, 'Check-ins'],
          [p.streak, 'Day streak'],
        ].map(([num, label]) => (
          <div key={label} className="nui-stat">
            <strong>{num}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="nui-found">
        <ProgressRing found={SAMPLE_FOUND} total={total || 1} size={52} count={false} />
        <div>
          <p className="nui-row-title">
            {SAMPLE_FOUND} of {total.toLocaleString('en-US')} found in {CITY.name}
          </p>
          <p className="nui-meta">Every check-in fills the ring.</p>
        </div>
      </div>
      <MaprLine>You're on a {p.streak} day streak. I have a pick for tomorrow when you want it.</MaprLine>
      <ul className="nui-list nui-group nui-section">
        {PROFILE_ROWS.map((r) => (
          <li key={r}>
            <button type="button" className="nui-row" onClick={() => onOpenPage(r)}>
              <span className="nui-row-text">
                <span className="nui-row-title">{r}</span>
              </span>
              <Icon d={CHEVRON} size={16} className="nui-chev" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="nui-btn nui-wide" onClick={() => onOpenPage('Edit profile')}>
        Edit profile
      </button>
    </div>
  );
}

function PageScreen({ title, onBack, backLabel }) {
  return (
    <div className="nui-screen nui-screen-pushed">
      <BackBar label={backLabel} onBack={onBack} />
      <h1 className="nui-title">{title}</h1>
      <div className="nui-empty">
        <p className="nui-row-title">Not in this preview yet</p>
        <p className="nui-meta">The New UI covers Landmarks, Itinerary and Profile. {title} keeps its current design in the app for now.</p>
      </div>
    </div>
  );
}

// ---------- Plan a trip (sheet) ----------

const WHEN = [
  { id: 'today', label: 'Today' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'next', label: 'Next week' },
];

// A sheet with a medium and a large detent (HIG: progressive disclosure,
// a grabber, swipe down to dismiss, Cancel as well as the main action).
// It follows the finger 1:1 from the grabber, the header, or the content
// when it's scrolled to the top; past the top it rubber-bands. On release
// the flick's projected landing point picks the detent, and only a flick
// earns a little bounce (Apple's sheet spring, 0.8 / 0.3).
function PlanSheet({ mode, places, onClosed }) {
  const panel = useRef(null);
  const scrim = useRef(null);
  const body = useRef(null);
  const geo = useRef({ h: 700, mid: 300 });
  const drag = useRef(null);
  const [detent, setDetent] = useState('mid');
  const [when, setWhen] = useState('today');
  const [what, setWhat] = useState(() => new Set(SAMPLE_TASTE));
  const kinds = useMemo(() => {
    const has = new Set(places.withPhoto.map(kindOf));
    return INTERESTS.filter((i) => has.has(i.id)).slice(0, 8);
  }, [places]);
  const picks = places.withPhoto.filter((l) => what.has(kindOf(l))).slice(0, 3);

  const apply = (y) => {
    if (panel.current) panel.current.style.transform = `translate3d(0,${y}px,0)`;
    if (scrim.current) scrim.current.style.opacity = String(Math.max(0, Math.min(1, 1 - y / geo.current.h)));
  };
  const [motion] = useState(() => new Spring(10000, apply));

  const close = useCallback(
    (velocity = 0) => {
      motion.to(geo.current.h, { ...SPRING.sheet, velocity, done: onClosed });
    },
    [onClosed, motion],
  );

  useLayoutEffect(() => {
    const h = panel.current.offsetHeight;
    geo.current = { h, mid: Math.round(h * 0.42) };
    motion.set(h);
    motion.to(geo.current.mid, SPRING.sheet);
    const before = document.activeElement;
    panel.current.focus({ preventScroll: true });
    return () => {
      motion.stop();
      before?.focus?.({ preventScroll: true });
    };
  }, [motion]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const settle = (target, velocity) => {
    if (target >= geo.current.h) {
      close(velocity);
      return;
    }
    setDetent(target === 0 ? 'large' : 'mid');
    motion.to(target, { ...(Math.abs(velocity) > 600 ? SPRING.sheetFlick : SPRING.sheet), velocity });
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const inBody = body.current?.contains(e.target);
    const v = new VelocityTracker();
    v.add(e.clientX, e.clientY, e.timeStamp);
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, v, inBody };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    d.v.add(e.clientX, e.clientY, e.timeStamp);
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.on) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        drag.current = null;
        return;
      }
      if (Math.abs(dy) < 10) return;
      const atLarge = motion.target === 0;
      // At the large detent the content scrolls; only a pull down from its
      // top moves the sheet.
      if (d.inBody && atLarge && (dy < 0 || body.current.scrollTop > 0)) {
        drag.current = null;
        return;
      }
      d.on = true;
      d.start = dy;
      panel.current.setPointerCapture?.(e.pointerId);
      motion.stop();
      d.y0s = motion.value;
    }
    let y = d.y0s + (dy - d.start);
    if (y < 0) y = rubberband(y, geo.current.h);
    motion.set(y);
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.on || e.pointerId !== d.id) return;
    const vy = d.v.get().y;
    const { h, mid } = geo.current;
    const landing = motion.value + project(vy);
    const target = [0, mid, h].reduce((best, t) => (Math.abs(t - landing) < Math.abs(best - landing) ? t : best), mid);
    settle(target, vy);
  };

  const toggle = (id) =>
    setWhat((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="nui nui-sheet-layer" data-mode={mode}>
      <div className="nui-scrim" ref={scrim} onClick={() => close()} aria-hidden="true" />
      <div
        className="nui-sheet"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nui-sheet-title"
        tabIndex={-1}
        data-detent={detent}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button type="button" className="nui-grabber" aria-label={detent === 'large' ? 'Make smaller' : 'Make larger'} onClick={() => settle(detent === 'large' ? geo.current.mid : 0, 0)}>
          <span />
        </button>
        <div className="nui-sheet-head">
          <button type="button" className="nui-text-btn" onClick={() => close()}>
            Cancel
          </button>
          <h2 id="nui-sheet-title" className="nui-sheet-title">
            New trip
          </h2>
          <button type="button" className="nui-btn-primary nui-btn-sm" onClick={() => close()} disabled={!what.size}>
            Plan
          </button>
        </div>
        <div className="nui-sheet-body" ref={body}>
          <MaprLine>Tell me when you're free and what you're in the mood for. I'll build the day around it.</MaprLine>
          <p className="nui-label nui-gap-top">When</p>
          <div className="nui-gap-sm">
            <Segmented label="When" options={WHEN} value={when} onChange={setWhen} />
          </div>
          <p className="nui-label nui-gap-top">What for</p>
          <div className="nui-chips nui-chips-wrap" role="group" aria-label="What for">
            {kinds.map((k) => (
              <button key={k.id} type="button" className={`nui-chip ${what.has(k.id) ? 'on' : ''}`} aria-pressed={what.has(k.id)} onClick={() => toggle(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
          {picks.length > 0 && (
            <section className="nui-section">
              <p className="nui-label">I'd start with</p>
              <ul className="nui-list">
                {picks.map((p) => (
                  <li key={p.id}>
                    <div className="nui-row nui-row-static">
                      <Photo place={p} className="nui-thumb" />
                      <span className="nui-row-text">
                        <span className="nui-row-title">{p.name}</span>
                        <span className="nui-meta">{p.neighborhood || labelOf(kindOf(p))}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="nui-meta nui-sheet-note">Nothing here is saved.</p>
        </div>
      </div>
    </div>
  );
}

// ---------- Tab bar ----------

function TabBar({ mode, tab, onSelect }) {
  const wrap = useRef(null);
  const pill = useRef(null);
  useSlidingPill(wrap, pill, tab);
  return (
    <nav className="nui nui-tabbar" data-mode={mode} aria-label="Tabs" ref={wrap}>
      <span className="nui-tab-pill" ref={pill} aria-hidden="true" />
      {TABS.map((t) => (
        <button key={t.id} type="button" data-on={tab === t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => onSelect(t.id)}>
          <span className="nui-tab-icon" aria-hidden="true">
            {t.icon}
          </span>
          <span className="nui-tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ---------- Shell ----------

function initialMode() {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

let entryKey = 0;
const EMPTY_STACKS = { landmarks: [], itinerary: [], profile: [] };
const ROOT_LABEL = { landmarks: 'Landmarks', itinerary: 'Itinerary', profile: 'Profile' };

export default function NewUILab() {
  const [tab, setTab] = useState('map');
  const [mode, setMode] = useState(initialMode);
  const [full, setFull] = useState(false);
  const [stacks, setStacks] = useState(EMPTY_STACKS);
  // A tab's screen stays mounted once opened, so it keeps its scroll,
  // search and filters when you come back, as iOS tabs do.
  const [opened, setOpened] = useState(() => new Set());
  const [sheet, setSheet] = useState(false);
  const frame = useRef(null);
  const places = useCityPlaces();

  useEffect(() => {
    if (!full) return undefined;
    document.body.classList.add('ui-lab-full');
    const onKey = (e) => e.key === 'Escape' && !sheet && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('ui-lab-full');
      window.removeEventListener('keydown', onKey);
    };
  }, [full, sheet]);

  // The live parts (header, Mapr tab) read the app's theme from
  // <html data-theme>, so while the New UI is open the page takes the
  // preview's Light / Dark, and gets its own back when you leave.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.getAttribute('data-theme');
    root.setAttribute('data-theme', mode);
    return () => {
      if (before == null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', before);
    };
  }, [mode]);

  // The live map's look (blue pins, green when checked in) is scoped to
  // body[data-apple='map'], which the app sets only on its Map route.
  const live = LIVE_TABS.has(tab);
  useEffect(() => {
    if (tab !== 'map') return undefined;
    const before = document.body.dataset.apple;
    document.body.dataset.apple = 'map';
    return () => {
      if (before == null) delete document.body.dataset.apple;
      else document.body.dataset.apple = before;
    };
  }, [tab]);

  const push = (id, entry) => setStacks((s) => ({ ...s, [id]: [...s[id], { ...entry, key: ++entryKey }] }));
  const pops = useMemo(() => Object.fromEntries(STACK_TABS.map((id) => [id, () => setStacks((s) => ({ ...s, [id]: s[id].slice(0, -1) }))])), []);

  const select = (id) => {
    if (id === tab && STACK_TABS.includes(id)) {
      // Tapping the current tab goes back to its top, as on iOS.
      if (stacks[id].length) setStacks((s) => ({ ...s, [id]: [] }));
      else frame.current?.querySelector(`[data-stack="${id}"] .nui-scroll[data-top]`)?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (STACK_TABS.includes(id)) setOpened((o) => (o.has(id) ? o : new Set(o).add(id)));
    setTab(id);
  };

  const openPlace = (id) => (p, why) => push(id, { kind: 'place', title: p.name, place: p, why: why || whyFor(p, places.withPhoto.indexOf(p)) });
  const roots = {
    landmarks: <LandmarksScreen places={places} onOpen={openPlace('landmarks')} />,
    itinerary: <ItineraryScreen places={places} onOpen={openPlace('itinerary')} onOpenTrip={(t) => push('itinerary', { kind: 'trip', title: t.name, trip: t })} onPlan={() => setSheet(true)} />,
    profile: <ProfileScreen places={places} onOpenPage={(title) => push('profile', { kind: 'page', title })} />,
  };
  const render = (id) => (entry, back, backLabel) => {
    if (entry.kind === 'place') return <PlaceScreen place={entry.place} why={entry.why} onBack={back} backLabel={backLabel} />;
    if (entry.kind === 'trip') return <TripScreen trip={entry.trip} onOpen={openPlace(id)} onBack={back} backLabel={backLabel} />;
    return <PageScreen title={entry.title} onBack={back} backLabel={backLabel} />;
  };

  const phone = (
    <div className={`nui-frame ${full ? 'nui-full' : ''}`} data-tab={tab} ref={frame} onTouchStart={() => {}}>
      {live && (
        // The live Map and Mapr tabs, unchanged: none of the New UI styles reach them.
        <div className={`nui-live nui-live-${tab}`} key={tab}>
          <Suspense fallback={null}>{tab === 'map' ? <LiveMap /> : <Mapr />}</Suspense>
        </div>
      )}
      {STACK_TABS.filter((id) => opened.has(id) || id === tab).map((id) => (
        <div key={id} className="nui nui-tabview" data-mode={mode} data-stack={id} data-active={tab === id ? 'true' : undefined} hidden={tab !== id}>
          <StackView root={roots[id]} rootLabel={ROOT_LABEL[id]} stack={stacks[id]} render={render(id)} onPop={pops[id]} />
        </div>
      ))}
      {!live && <div className="nui nui-edge" data-mode={mode} aria-hidden="true" />}
      <div className="nui-apphead">
        <Suspense fallback={null}>
          <Header />
        </Suspense>
      </div>
      <TabBar mode={mode} tab={tab} onSelect={select} />
      {sheet && <PlanSheet mode={mode} places={places} onClosed={() => setSheet(false)} />}
      {full && (
        <button type="button" className="nui-exit" aria-label="Exit full screen" onClick={() => setFull(false)}>
          <Icon d={<path d="M6 6l12 12M18 6 6 18" />} size={14} />
        </button>
      )}
    </div>
  );

  return (
    <div className="nui-lab">
      <div className="nui nui-bar" data-mode={mode}>
        <p className="nui-bar-note">New UI · nothing here is saved</p>
        <button type="button" className="nui-mode" onClick={() => setMode((m) => (m === 'dark' ? 'light' : 'dark'))} aria-label={`Show ${mode === 'dark' ? 'light' : 'dark'} mode`}>
          {mode === 'dark' ? 'Light' : 'Dark'}
        </button>
        <button type="button" className="nui-mode" onClick={() => setFull(true)} aria-label="Full screen">
          Full screen
        </button>
      </div>
      {full ? (
        <div role="dialog" aria-modal="true" aria-label="New UI, full screen">
          {phone}
        </div>
      ) : (
        phone
      )}
    </div>
  );
}
