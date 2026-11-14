import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { ALL_LANDMARKS, INTERESTS } from '../data/regions';
import { ensurePlacePacks, usePlacePacksVersion } from '../lib/placePacks';
import { NAV_ITEMS } from '../components/BottomNav';
import './NewUILab.css';

// The real Mapr tab, exactly as it is in the app (owner, 2026-11-14).
const Mapr = lazy(() => import('./Mapr'));
// The real Map tab, exactly as it is in the app: satellite view, blue pins,
// green once checked in (owner, 2026-11-14).
const LiveMap = lazy(() => import('./MapExplore'));
// The app's real header (logo, streak, points, @username), kept as it is
// and floating over the New UI (owner, 2026-11-14).
const Header = lazy(() => import('../components/Header'));

// Test tab: "New UI" (owner, 2026-11-14). The app in the design language of
// docs/design-language.md: Quiet base (white, Inter, gold as the only
// accent) with Mapr as the Character inside it. The full bottom tab bar
// with all 5 tabs; Landmarks, Itinerary and Profile are redesigned,
// Map and Mapr are the live tabs unchanged, shown in the preview's
// Light / Dark. The app's real header and its emoji tabs float on top. Places are the real Miami catalog;
// trips, points and the "why you" lines are samples. Nothing in the
// redesigned tabs is saved; the Light / Dark switch only changes this preview.

// The app's own bottom tabs with their emojis, kept (owner, 2026-11-14),
// as a floating capsule. Same labels and emojis as src/components/BottomNav.
const TAB_IDS = { Map: 'map', Landmarks: 'landmarks', Mapr: 'mapr', Itinerary: 'itinerary', Profile: 'profile' };
const TABS = NAV_ITEMS.map((n) => ({ id: TAB_IDS[n.label], label: n.label, icon: n.icon }));

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
const BACK = <path d="m15 6-6 6 6 6" />;

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

function PlaceCard({ place, why, onOpen }) {
  return (
    <button type="button" className="nui-card" onClick={() => onOpen(place)}>
      <Photo place={place} className="nui-card-photo" />
      <span className="nui-card-name">{place.name}</span>
      <span className="nui-card-why">{why}</span>
    </button>
  );
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

// ---------- Place (opens from any tab) ----------

function PlaceScreen({ place, why, onBack }) {
  const [added, setAdded] = useState(false);
  const sourced = (place.facts || []).filter((f) => place.factSources?.[f]).slice(0, 3);
  return (
    <div className="nui-screen-flush">
      <div className="nui-hero">
        <Photo place={place} className="nui-hero-photo" />
        <button type="button" className="nui-hero-back" onClick={onBack} aria-label="Back">
          <Icon d={BACK} />
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
          <button type="button" className="nui-btn-primary" aria-pressed={added} onClick={() => setAdded((a) => !a)}>
            {added ? 'Added to trip' : 'Add to trip'}
          </button>
          <button type="button" className="nui-btn">
            Directions
          </button>
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

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

// ---------- Landmarks ----------

const SORTS = [
  { id: 'for-you', label: 'For you' },
  { id: 'nearby', label: 'Nearby' },
  { id: 'az', label: 'A–Z' },
];

function LandmarksTab({ places, onOpen }) {
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('for-you');
  const kinds = useMemo(() => {
    const counts = {};
    for (const l of places.withPhoto) counts[kindOf(l)] = (counts[kindOf(l)] || 0) + 1;
    return INTERESTS.filter((i) => counts[i.id]).map((i) => i.id);
  }, [places]);
  let list = places.withPhoto.filter((l) => kind === 'all' || kindOf(l) === kind);
  if (sort === 'az') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'nearby') list = [...list].sort((a, b) => a.lat - b.lat);
  return (
    <div className="nui-screen">
      <p className="nui-label">
        {CITY.name} · {places.all.length.toLocaleString('en-US')} places
      </p>
      <h1 className="nui-title">Landmarks</h1>
      <div className="nui-search" role="search">
        <Icon d={SEARCH} size={16} />
        <span>Search places</span>
      </div>
      <div className="nui-chips nui-gap-top" role="group" aria-label="Kind of place">
        {['all', ...kinds].map((k) => (
          <button key={k} type="button" className={`nui-chip ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === 'all' ? 'All' : labelOf(k)}
          </button>
        ))}
      </div>
      <div className="nui-seg nui-seg-inline" role="tablist" aria-label="Sort">
        {SORTS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={sort === s.id} className={sort === s.id ? 'on' : ''} onClick={() => setSort(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <ul className="nui-list">
        {list.slice(0, 30).map((p, i) => (
          <li key={p.id}>
            <button type="button" className="nui-list-row" onClick={() => onOpen(p)}>
              <Photo place={p} className="nui-thumb" />
              <span className="nui-list-text">
                <span className="nui-row-title">{p.name}</span>
                <span className="nui-meta">
                  {p.neighborhood || labelOf(kindOf(p))}
                  {p.typicalMinutes ? ` · ${minutes(p.typicalMinutes)}` : ''}
                </span>
                <span className="nui-why">{whyFor(p, i)}</span>
              </span>
              <Icon d={CHEVRON} size={16} className="nui-chev" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Itinerary ----------

function ItineraryTab({ places, onOpen }) {
  const day = places.withPhoto.slice(0, 3);
  const found = 2;
  const trips = [
    { id: 'weekend', name: `${CITY.name} weekend`, when: 'Nov 21 – 23', stops: places.withPhoto.slice(3, 8) },
    { id: 'beach', name: 'South Beach morning', when: 'Saved', stops: places.withPhoto.slice(8, 11) },
  ];
  const walk = ['', '12 min walk', '25 min by bus'];
  return (
    <div className="nui-screen">
      <p className="nui-label">Today · {CITY.name}</p>
      <div className="nui-title-row">
        <h1 className="nui-title">Itinerary</h1>
        <ProgressRing found={found} total={day.length} />
      </div>
      {day.length > 2 && <MaprLine>One stop left. {day[2].name} is next, and it closes out your day.</MaprLine>}
      <ol className="nui-stops">
        {day.map((p, i) => (
          <li key={p.id} className="nui-stop">
            {walk[i] && <p className="nui-walk">{walk[i]}</p>}
            <button type="button" className="nui-stop-row" onClick={() => onOpen(p)}>
              <span className={`nui-stop-num ${i < found ? 'found' : ''}`}>{i + 1}</span>
              <span className="nui-stop-time">{['9:30', '12:15', '2:00'][i]}</span>
              <span className="nui-list-text">
                <span className="nui-row-title">{p.name}</span>
                <span className="nui-meta">{i < found ? 'Checked in' : p.neighborhood || labelOf(kindOf(p))}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="nui-btn-primary nui-wide">
        Plan a trip
      </button>

      <section className="nui-section">
        <h2 className="nui-h2">Your trips</h2>
        {trips.map((t) => (
          <button key={t.id} type="button" className="nui-trip" onClick={() => t.stops[0] && onOpen(t.stops[0])}>
            <span className="nui-trip-photos" aria-hidden="true">
              {t.stops.slice(0, 3).map((s) => (
                <Photo key={s.id} place={s} className="nui-trip-photo" />
              ))}
            </span>
            <span className="nui-trip-text">
              <span className="nui-row-title">{t.name}</span>
              <span className="nui-meta">
                {t.when} · {t.stops.length} places · about {minutes(t.stops.reduce((m, s) => m + (s.typicalMinutes || 45), 0))}
              </span>
              <span className="nui-why">{t.stops.slice(0, 3).map((s) => s.name).join(', ')}</span>
            </span>
            <Icon d={CHEVRON} size={16} className="nui-chev" />
          </button>
        ))}
      </section>
    </div>
  );
}

// ---------- Profile ----------

const PROFILE_ROWS = ['My memories', 'Full stats', 'Ranks', 'Leaderboard', 'Friends', 'Settings'];

function ProfileTab({ places }) {
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
        ].map(([n, label]) => (
          <div key={label} className="nui-stat">
            <strong>{n}</strong>
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
      <ul className="nui-list nui-section">
        {PROFILE_ROWS.map((r) => (
          <li key={r}>
            <div className="nui-list-row nui-row-static">
              <span className="nui-list-text">
                <span className="nui-row-title">{r}</span>
              </span>
              <Icon d={CHEVRON} size={16} className="nui-chev" />
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="nui-btn nui-wide">
        Edit profile
      </button>
    </div>
  );
}

// ---------- Shell ----------

function initialMode() {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export default function NewUILab() {
  const [tab, setTab] = useState('map');
  const [mode, setMode] = useState(initialMode);
  const [place, setPlace] = useState(null);
  const [full, setFull] = useState(false);
  const places = useCityPlaces();

  useEffect(() => {
    if (!full) return undefined;
    document.body.classList.add('ui-lab-full');
    const onKey = (e) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('ui-lab-full');
      window.removeEventListener('keydown', onKey);
    };
  }, [full]);

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
  const live = (tab === 'map' || tab === 'mapr') && !place;
  const liveMap = tab === 'map' && !place;
  useEffect(() => {
    if (!liveMap) return undefined;
    const before = document.body.dataset.apple;
    document.body.dataset.apple = 'map';
    return () => {
      if (before == null) delete document.body.dataset.apple;
      else document.body.dataset.apple = before;
    };
  }, [liveMap]);

  const open = (p) => setPlace({ p, why: whyFor(p, places.withPhoto.indexOf(p)) });
  const go = (id) => {
    setPlace(null);
    setTab(id);
  };

  let body;
  if (place) body = <PlaceScreen place={place.p} why={place.why} onBack={() => setPlace(null)} />;
  else if (tab === 'landmarks') body = <LandmarksTab places={places} onOpen={open} />;
  else if (tab === 'itinerary') body = <ItineraryTab places={places} onOpen={open} />;
  else if (tab === 'profile') body = <ProfileTab places={places} />;

  const phone = (
    <div className={`nui-frame ${full ? 'nui-full' : ''}`} data-tab={tab}>
      {live ? (
        // The live Map and Mapr tabs, unchanged: none of the New UI styles reach them.
        <div className={`nui-scroll nui-live nui-live-${tab}`} key={tab}>
          <Suspense fallback={null}>{tab === 'map' ? <LiveMap /> : <Mapr />}</Suspense>
        </div>
      ) : (
        <div className="nui nui-scroll" data-mode={mode} key={place ? place.p.id : tab}>
          {body}
        </div>
      )}
      <div className="nui-apphead">
        <Suspense fallback={null}>
          <Header />
        </Suspense>
      </div>
      <nav className="nui nui-tabbar" data-mode={mode} aria-label="Tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
            <span className="nui-tab-icon" aria-hidden="true">
              {t.icon}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
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
