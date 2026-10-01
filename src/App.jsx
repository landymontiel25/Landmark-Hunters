import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
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
import BottomNav from './components/BottomNav';
import ErrorBoundary from './components/ErrorBoundary';
import OfflineBanner from './components/OfflineBanner';
import StreakWarningBanner from './components/StreakWarningBanner';
import CheckInReview from './components/CheckInReview';
import LoveReasonPrompt from './components/LoveReasonPrompt';
import TagCapPrompt from './components/TagCapPrompt';
import HabitPlacePrompt from './components/HabitPlacePrompt';
import CelebrationOverlay from './components/CelebrationOverlay';
import AdminModeBadge from './components/AdminModeBadge';
import { ScreenSkeleton } from './components/Skeleton';
import { ToastProvider } from './lib/ToastContext';
import { useBackgroundLocationSync } from './lib/useBackgroundLocationSync';
import { usePushNotificationsSync } from './lib/usePushNotificationsSync';
import { useOnboardingNotice } from './lib/useOnboardingNotice';

// Renders nothing -- just needs to sit inside AuthProvider/FriendsProvider to
// start/stop push registration as the traveler's own saved preference
// (Settings) changes.
function PushNotificationsSync() {
  usePushNotificationsSync();
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

// Each screen is its own file with a content hash in its name, and every
// deploy replaces them. A tab opened before a deploy then asks for a file
// that's gone, and the screen crashed with "Something went wrong" -- the
// usual cause of that screen. Reload once to pick up the current version
// (the flag stops a reload loop if the file is missing for another reason).
const RELOAD_FLAG = 'lh-chunk-reload';
// sessionStorage can throw (blocked storage); that must never turn a
// successfully loaded screen into "Something went wrong".
const flagGet = () => {
  try {
    return sessionStorage.getItem(RELOAD_FLAG);
  } catch {
    return null;
  }
};
const flagSet = () => {
  try {
    sessionStorage.setItem(RELOAD_FLAG, '1');
  } catch {
    /* blocked storage */
  }
};
const flagClear = () => {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    /* blocked storage */
  }
};
function lazyScreen(load) {
  return lazy(() =>
    load()
      .then((m) => {
        flagClear();
        return m;
      })
      .catch((err) => {
        if (!flagGet()) {
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
    if (flagGet()) return;
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
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
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
          <BackgroundLocationSync />
          <PushNotificationsSync />
          <OnboardingNoticeSync />
          <OfflineBanner />
          <StreakWarningBanner />
          <Header />
          <main className="app-main">
            <AppRoutes />
          </main>
          <BottomNav />
          <CheckInReview />
          <LoveReasonPrompt />
          <TagCapPrompt />
          <HabitPlacePrompt />
          <CelebrationOverlay />
          <AdminModeBadge />
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
