import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MapUILab from './MapUILab';
import { LandmarksUILab, ItineraryUILab, ProfileUILab } from './AppleScreens';
import './UILab.css';
import './AppleUI.css';

// Test tab: "UI". The app's redesign, one screen per tab, built for the
// iPhone first (the web shows the same screens at phone width). Each tab of
// the app gets a sub-tab here; Full screen shows the chosen screen the way
// the phone would, with no app header or nav, and its own tab bar to move
// between screens. Map is designed so far (Mapr's design is live in the Mapr
// tab); Map, Landmarks, Itinerary and Profile are in the Apple Maps look.
const UI_SCREENS = [
  { id: 'map', label: 'Map', screen: MapUILab, exit: 'low-right' },
  { id: 'landmarks', label: 'Landmarks', screen: LandmarksUILab },
  // Shipped: the Mapr tab now opens on this design (MaprHome).
  { id: 'mapr', label: 'Mapr', screen: null, live: '/mapr' },
  { id: 'itinerary', label: 'Itinerary', screen: ItineraryUILab },
  { id: 'profile', label: 'Profile', screen: ProfileUILab },
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
  test: (
    <>
      <path d="M9.5 3.5h5M10.5 3.5v5.2L5 18.4a1.8 1.8 0 0 0 1.6 2.6h10.8a1.8 1.8 0 0 0 1.6-2.6l-5.5-9.7V3.5" />
      <path d="M7.7 14.5h8.6" />
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

// The capsule's sixth tab. This lab lives on the Test tab, so it is the tab
// bar's own Test: it leaves Full screen and otherwise stays put.
const TEST_TAB = { id: 'test', label: 'Test' };

function Screen({ id, fullScreen }) {
  const navigate = useNavigate();
  const entry = UI_SCREENS.find((s) => s.id === id);
  if (entry.screen) {
    const S = entry.screen;
    return <S fullScreen={fullScreen} />;
  }
  return (
    <div className={`uil-empty ${fullScreen ? 'full' : ''}`}>
      <p className="uil-empty-title">{entry.label}</p>
      {entry.live ? (
        <>
          <p className="uil-empty-line">Live in the app</p>
          <button type="button" className="uil-open-live" onClick={() => navigate(entry.live)}>
            Open {entry.label}
          </button>
        </>
      ) : (
        <p className="uil-empty-line">Not designed yet</p>
      )}
    </div>
  );
}

export default function UILab() {
  const [screen, setScreen] = useState('map');
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

  const entry = UI_SCREENS.find((s) => s.id === screen);
  // The phone: the screen (scrolling on its own) with the floating tab bar
  // over its bottom. Full screen shows it edge to edge on the device; on the
  // page it sits in a phone-height frame under the sub-tabs.
  const phone = (
    <>
      <div className="uil-scroll" key={screen}>
        <Screen id={screen} fullScreen />
      </div>
      {full && (
        <button type="button" className={`uil-exit ${entry.exit || ''}`} aria-label="Exit full screen" onClick={() => setFull(false)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
      <nav className="uil-tabbar" aria-label="Screens">
        {UI_SCREENS.map((s) => (
          <button key={s.id} type="button" className={screen === s.id ? 'on' : ''} aria-current={screen === s.id ? 'page' : undefined} onClick={() => setScreen(s.id)}>
            <TabIcon id={s.id} />
            <span>{s.label}</span>
          </button>
        ))}
        <button type="button" onClick={() => setFull(false)}>
          <TabIcon id={TEST_TAB.id} />
          <span>{TEST_TAB.label}</span>
        </button>
      </nav>
    </>
  );

  if (full) {
    return (
      <div className="uil-phone uil-full" role="dialog" aria-modal="true" aria-label={`${entry.label}, full screen`}>
        {phone}
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
      <div className="uil-phone uil-frame">{phone}</div>
    </div>
  );
}
