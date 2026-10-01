import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { isAdmin } from '../lib/admins';

// 5 tabs -- Setup is no longer one of them (it's the "Create New Trip"
// modal inside Itinerary now). Mapr sits dead center: it's the app's home
// screen, the one thing people open every day, so it gets the "create"
// position instead of an end slot.
const items = [
  { to: '/', label: 'Map', icon: '\u{1F310}', end: true },
  { to: '/landmarks', label: 'Landmarks', icon: '\u{1F4CD}' },
  { to: '/mapr', label: 'Mapr', icon: '\u{1F9E0}' },
  { to: '/itinerary', label: 'Itinerary', icon: '\u{1F5FA}\u{FE0F}' },
  { to: '/profile', label: 'Profile', icon: '\u{1F3C6}' },
];

// Admin-only sandbox for trying out sign-up/onboarding (screens/OnboardingLab).
const TEST_TAB = { to: '/test', label: 'Test', icon: '\u{1F9EA}' };

// Plain-anchor stand-in, shown by App's boundary if BottomNav itself crashes:
// without it the user has no way off the current screen except a reload.
// Uses hash links so it needs nothing from the router or any context.
export function BottomNavFallback() {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map((item) => (
        <a key={item.to} href={`#${item.to}`}>
          <span className="nav-icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </a>
      ))}
    </nav>
  );
}

export default function BottomNav() {
  const navRef = useRef(null);
  const { user } = useAuth();
  const tabs = isAdmin(user?.email) ? [...items, TEST_TAB] : items;

  // If the page is zoomed anyway (pinch), position: fixed sticks to the
  // unzoomed layout viewport on iOS and the bar lands mid-screen. The
  // visual viewport API says where the visible area actually is; shift
  // the bar by the difference so it stays on the visible bottom edge.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = navRef.current;
    if (!vv || !el) return;
    const update = () => {
      // Only when actually zoomed in. At scale 1 iOS (especially the
      // home-screen app) can report the visible area a few dozen px
      // shorter than the window, which would nudge the bar up for no
      // reason and leave a gap under it.
      if (vv.scale <= 1.02) {
        el.style.transform = '';
        return;
      }
      const shift = Math.round(vv.offsetTop + vv.height - window.innerHeight);
      el.style.transform = shift ? `translateY(${shift}px) translateZ(0)` : '';
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return (
    <nav className="bottom-nav" ref={navRef} aria-label="Main">
      {tabs.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="nav-icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
