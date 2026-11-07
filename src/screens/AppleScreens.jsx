import LandmarkSelection from './LandmarkSelection';
import Itinerary from './Itinerary';
import Profile from './Profile';
import AppleTopBar from './AppleTopBar';
import './AppleUI.css';
import './AppleScreens.css';

// Test tab "UI": the Landmarks, Itinerary and Profile screens in the Apple
// Maps look. Each one is the real screen (same data, same buttons, same
// logic) under the shared Apple top bar; AppleScreens.css reskins it, so
// nothing about what the screens do changes.
function AppleScreen({ name, children }) {
  return (
    <div className={`aps aps-${name}`}>
      <AppleTopBar />
      <div className="aps-body">{children}</div>
    </div>
  );
}

export const LandmarksUILab = () => (
  <AppleScreen name="landmarks">
    <LandmarkSelection />
  </AppleScreen>
);
export const ItineraryUILab = () => (
  <AppleScreen name="itinerary">
    <Itinerary />
  </AppleScreen>
);
export const ProfileUILab = () => (
  <AppleScreen name="profile">
    <Profile />
  </AppleScreen>
);
