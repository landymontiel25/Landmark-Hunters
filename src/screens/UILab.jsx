import { useEffect, useState } from 'react';
import MaprUILab from './MaprUILab';
import MapUILab from './MapUILab';
import './UILab.css';

// Test tab: "UI". The app's redesign, one screen per tab, built for the
// iPhone first (the web shows the same screens at phone width). Each tab of
// the app gets a sub-tab here; Full screen shows the chosen screen the way
// the phone would, with no app header or nav, and its own tab bar to move
// between screens. Map and Mapr are designed so far; the rest wait for the
// owner's mockups.
const UI_SCREENS = [
  { id: 'map', label: 'Map', screen: MapUILab, exit: 'low-right' },
  { id: 'landmarks', label: 'Landmarks', screen: null },
  { id: 'mapr', label: 'Mapr', screen: MaprUILab },
  { id: 'itinerary', label: 'Itinerary', screen: null },
  { id: 'profile', label: 'Profile', screen: null },
];

const TAB_ICONS = {
  map: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z" />
    </>
  ),
  landmarks: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  mapr: <path d="M12 3c.8 5 3 7.3 8.5 9-5.5 1.7-7.7 4-8.5 9-.8-5-3-7.3-8.5-9 5.5-1.7 7.7-4 8.5-9z" />,
  itinerary: (
    <>
      <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20.5c1.2-3.8 4-5.6 7.5-5.6s6.3 1.8 7.5 5.6" />
    </>
  ),
};

function TabIcon({ id }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TAB_ICONS[id]}
    </svg>
  );
}

function Screen({ id, fullScreen }) {
  const entry = UI_SCREENS.find((s) => s.id === id);
  if (entry.screen) {
    const S = entry.screen;
    return <S fullScreen={fullScreen} />;
  }
  return (
    <div className={`uil-empty ${fullScreen ? 'full' : ''}`}>
      <p className="uil-empty-title">{entry.label}</p>
      <p className="uil-empty-line">Not designed yet</p>
    </div>
  );
}

export default function UILab() {
  const [screen, setScreen] = useState('mapr');
  const [full, setFull] = useState(false);

  // Full screen hides the app's own header and nav (the same way the photo
  // lightbox does) and locks the page behind it. Escape leaves it.
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

  if (full) {
    return (
      <div className="uil-full" role="dialog" aria-modal="true" aria-label={`${UI_SCREENS.find((s) => s.id === screen).label}, full screen`}>
        <div className="uil-full-scroll" key={screen}>
          <Screen id={screen} fullScreen />
        </div>
        <button type="button" className={`uil-exit ${UI_SCREENS.find((s) => s.id === screen).exit || ''}`} aria-label="Exit full screen" onClick={() => setFull(false)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <nav className="uil-tabbar" aria-label="Screens">
          {UI_SCREENS.map((s) => (
            <button key={s.id} type="button" className={screen === s.id ? 'on' : ''} aria-current={screen === s.id ? 'page' : undefined} onClick={() => setScreen(s.id)}>
              <TabIcon id={s.id} />
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
      </div>
    );
  }

  return (
    <div className="uil">
      <div className="uil-bar">
        <div className="uil-tabs" role="tablist" aria-label="UI screens">
          {UI_SCREENS.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={screen === s.id} className={`uil-tab ${screen === s.id ? 'on' : ''}`} onClick={() => setScreen(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" className="uil-full-btn" aria-label="Full screen" title="Full screen" onClick={() => setFull(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>
      <Screen id={screen} fullScreen={false} />
    </div>
  );
}
