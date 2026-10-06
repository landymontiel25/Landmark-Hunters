import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import { MaprChatProvider } from './lib/MaprChatContext';
import { CheckInProvider } from './lib/CheckInContext';
import { TripProvider } from './lib/TripContext';
import { GeoProvider } from './lib/GeoContext';
import { RatingsProvider } from './lib/RatingsContext';
import { MyPhotosProvider } from './lib/MyPhotosContext';
import { FriendsProvider } from './lib/FriendsContext';
import { UnitsProvider } from './lib/UnitsContext';
import { BadgesProvider } from './lib/BadgesContext';
import { PairStreakProvider } from './lib/PairStreakContext';
import { AdminModeProvider } from './lib/AdminModeContext';
import { LandmarkEditsProvider } from './lib/LandmarkEditsContext';
import Header from './components/Header';
import BottomNav, { BottomNavFallback } from './components/BottomNav';
import ErrorBoundary from './components/ErrorBoundary';
import OfflineBanner from './components/OfflineBanner';
import StreakWarningBanner from './components/StreakWarningBanner';
import CheckInReview from './components/CheckInReview';
import LoveReasonPrompt from './components/LoveReasonPrompt';
import TagCapPrompt from './components/TagCapPrompt';
import GlobalTasteSync from './lib/useGlobalTaste';
import HabitPlacePrompt from './components/HabitPlacePrompt';
import CelebrationOverlay from './components/CelebrationOverlay';
import AdminModeBadge from './components/AdminModeBadge';
import { ScreenSkeleton } from './components/Skeleton';
import { ToastProvider } from './lib/ToastContext';
import { useBackgroundLocationSync } from './lib/useBackgroundLocationSync';
import { usePushNotificationsSync } from './lib/usePushNotificationsSync';
import { useOnboardingNotice } from './lib/useOnboardingNotice';
import { useTripAccountGuard } from './lib/tripAccountGuard';
import { installModalA11y } from './lib/modalA11y';
import { useDocumentTitle } from './lib/useDocumentTitle';
import { shouldResetScroll } from './lib/scrollReset';
import { flagClear, flagSet, shouldReloadForChunkError } from './lib/chunkReload';

// Renders nothing -- just needs to sit inside AuthProvider/FriendsProvider to
// start/stop push registration as the traveler's own saved preference
// (Settings) changes.
function PushNotificationsSync() {
  usePushNotificationsSync();
  return null;
}

// Renders nothing -- clears the device-local trip when a different account
// (or nobody) is signed in than the one that built it.
function TripAccountGuard() {
  useTripAccountGuard();
  return null;
}

// Renders nothing -- per-route document title (inside the router).
function DocumentTitleSync() {
  useDocumentTitle();
  return null;
}

// Tapping into a main tab used to keep the previous page's scroll position
// (the Landmarks list opened halfway down). Fresh navigations to a tab start
// at the top; Back/Forward (POP) is left alone so lists that restore their
// own position (CheckinsGallery) keep working.
function ScrollToTopOnNavigate() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  useEffect(() => {
    if (shouldResetScroll(pathname, navType)) window.scrollTo(0, 0);
  }, [pathname, navType]);
  return null;
}

function OnboardingNoticeSync() {
  useOnboardingNotice();
  return null;
}

// Renders nothing -- just needs to sit inside AuthProvider/FriendsProvider to
// start/stop the real background location watcher as the traveler's own
// saved preference (Settings, or the onboarding step) changes.
function BackgroundLocationSync() {
  useBackgroundLocationSync();
  return null;
}

// A boundary that renders nothing when its child crashes (see ErrorBoundary's
// `fallback`), for the chrome that stays mounted on every screen.
function Soft({ children }) {
  return <ErrorBoundary fallback={null}>{children}</ErrorBoundary>;
}

// Each screen is its own file with a content hash in its name, and every
// deploy replaces them. A tab opened before a deploy then asks for a file
// that's gone, and the screen crashed with "Something went wrong" -- the
// usual cause of that screen. Reload once to pick up the current version
// (the flag stops a reload loop if the file is missing for another reason).
// Every screen loader, so they can be fetched ahead of time (see
// prefetchScreens): a screen first opened while the connection is down used
// to land on "Something went wrong", because its file had never been loaded.
const screenLoaders = [];
function lazyScreen(load) {
  screenLoaders.push(load);
  return lazy(() =>
    load()
      .then((m) => {
        flagClear();
        return m;
      })
      .catch((err) => {
        if (shouldReloadForChunkError()) {
          flagSet();
          window.location.reload();
          return new Promise(() => {});
        }
        throw err;
      })
  );
}
// Vite's own signal for the same thing (a preloaded dependency is gone).
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (e) => {
    if (!shouldReloadForChunkError()) return;
    e.preventDefault();
    flagSet();
    window.location.reload();
  });
}

// Lazy so each screen (and, critically, Leaflet + its cluster plugin --
// only pulled in by MapExplore/AddLandmark) ships as its own chunk instead
// of all up front in one bundle, same as everything past the entry chunk
// that Vite would otherwise inline.
const LandmarkSelection = lazyScreen(() => import('./screens/LandmarkSelection'));
const MapExplore = lazyScreen(() => import('./screens/MapExplore'));
const AddLandmark = lazyScreen(() => import('./screens/AddLandmark'));
const LandmarkDetail = lazyScreen(() => import('./screens/LandmarkDetail'));
const Itinerary = lazyScreen(() => import('./screens/Itinerary'));
const Profile = lazyScreen(() => import('./screens/Profile'));
const FullLeaderboard = lazyScreen(() => import('./screens/FullLeaderboard'));
const Legal = lazyScreen(() => import('./screens/Legal'));
const GroupTrip = lazyScreen(() => import('./screens/GroupTrip'));
const Settings = lazyScreen(() => import('./screens/Settings'));
const FullStats = lazyScreen(() => import('./screens/FullStats'));
const MyCheckins = lazyScreen(() => import('./screens/MyCheckins'));
const MyMaprRatings = lazyScreen(() => import('./screens/MyMaprRatings'));
const MyCities = lazyScreen(() => import('./screens/MyCities'));
const MyStreaks = lazyScreen(() => import('./screens/MyStreaks'));
const FriendCheckins = lazyScreen(() => import('./screens/FriendCheckins'));
const FriendCities = lazyScreen(() => import('./screens/FriendCities'));
const Notifications = lazyScreen(() => import('./screens/Notifications'));
const RequestFeature = lazyScreen(() => import('./screens/RequestFeature'));
const ReportBug = lazyScreen(() => import('./screens/ReportBug'));
const Mapr = lazyScreen(() => import('./screens/Mapr'));
const OnboardingLab = lazyScreen(() => import('./screens/OnboardingLab'));
const Onboarding = lazyScreen(() => import('./screens/Onboarding'));
const NotFound = lazyScreen(() => import('./screens/NotFound'));

// Keyed by path so a crash's fallback UI clears itself on the next
// navigation (React Router doesn't remount the boundary just because the
// matched route changed -- only re-keying it does).

function AppRoutes() {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.pathname}>
      <Suspense fallback={<ScreenSkeleton />}>
        <Routes>
          <Route path="/" element={<MapExplore />} />
          <Route path="/add-landmark" element={<AddLandmark />} />
          <Route path="/landmarks" element={<LandmarkSelection />} />
          <Route path="/landmarks/:region/:id" element={<LandmarkDetail />} />
          <Route path="/itinerary" element={<Itinerary />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/leaderboard" element={<Profile />} />
          <Route path="/leaderboard/full" element={<FullLeaderboard />} />
          <Route path="/account" element={<Profile />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/group/:tripId" element={<GroupTrip />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/stats" element={<FullStats />} />
          <Route path="/checkins" element={<MyCheckins />} />
          <Route path="/mapr-ratings" element={<MyMaprRatings />} />
          <Route path="/cities" element={<MyCities />} />
          <Route path="/streaks" element={<MyStreaks />} />
          <Route path="/friend/:uid/checkins" element={<FriendCheckins />} />
          <Route path="/friend/:uid/cities" element={<FriendCities />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/request-feature" element={<RequestFeature />} />
          <Route path="/report-bug" element={<ReportBug />} />
          <Route path="/mapr" element={<Mapr />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/test" element={<OnboardingLab />} />
          <Route path="/test/onboarding" element={<OnboardingLab />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

// After the app is up and quiet, quietly load the remaining screens one at a
// time, so a dropped connection mid-session doesn't make the next screen
// fail. Skipped on Data Saver / offline; failures are ignored (best effort).
const PREFETCH_START_MS = 4000;
const PREFETCH_GAP_MS = 400;
function prefetchScreens() {
  if (typeof navigator === 'undefined') return () => {};
  if (navigator.onLine === false || navigator.connection?.saveData) return () => {};
  const loaders = [...screenLoaders, () => import('./screens/TripSetup')];
  let cancelled = false;
  let timer = setTimeout(async function run() {
    for (const load of loaders) {
      if (cancelled || navigator.onLine === false) return;
      try {
        await load();
      } catch {
        /* best effort */
      }
      await new Promise((r) => {
        timer = setTimeout(r, PREFETCH_GAP_MS);
      });
    }
  }, PREFETCH_START_MS);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

export default function App() {
  useEffect(() => prefetchScreens(), []);
  useEffect(() => installModalA11y(), []);
  return (
    <ToastProvider>
    <AuthProvider>
      <AdminModeProvider>
      <LandmarkEditsProvider>
      <FriendsProvider>
      <CheckInProvider>
      <TripProvider>
      <BadgesProvider>
        <PairStreakProvider>
        <GeoProvider>
          <RatingsProvider>
          <MyPhotosProvider>
          <UnitsProvider>
          <MaprChatProvider>
          <HashRouter>
          <TripAccountGuard />
          <DocumentTitleSync />
          <ScrollToTopOnNavigate />
          <BackgroundLocationSync />
          <PushNotificationsSync />
          <OnboardingNoticeSync />
          <Soft><GlobalTasteSync /></Soft>
          {/* Each always-on piece gets its own boundary: without one, a crash
              in any of them (they sit outside the per-screen boundary) takes
              down the whole app to a blank white page. */}
          <Soft><OfflineBanner /></Soft>
          <Soft><StreakWarningBanner /></Soft>
          <Soft><Header /></Soft>
          <main className="app-main">
            <AppRoutes />
          </main>
          <ErrorBoundary fallback={<BottomNavFallback />}><BottomNav /></ErrorBoundary>
          <Soft><CheckInReview /></Soft>
          <Soft><LoveReasonPrompt /></Soft>
          <Soft><TagCapPrompt /></Soft>
          <Soft><HabitPlacePrompt /></Soft>
          <Soft><CelebrationOverlay /></Soft>
          <Soft><AdminModeBadge /></Soft>
          </HashRouter>
          </MaprChatProvider>
          </UnitsProvider>
          </MyPhotosProvider>
          </RatingsProvider>
        </GeoProvider>
        </PairStreakProvider>
      </BadgesProvider>
      </TripProvider>
      </CheckInProvider>
      </FriendsProvider>
      </LandmarkEditsProvider>
      </AdminModeProvider>
    </AuthProvider>
    </ToastProvider>
  );
}
