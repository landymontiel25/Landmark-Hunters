import { registerPlugin } from '@capacitor/core';

// Real background location -- unlike @capacitor/geolocation (GeoContext.jsx),
// this plugin keeps reporting fixes while the app is backgrounded or the
// phone is locked, via iOS's "Always" authorization (see
// NSLocationAlwaysAndWhenInUseUsageDescription + UIBackgroundModes: location
// in ios/App/App/Info.plist). Requires a native build -- there is no web
// fallback, since no browser can wake JS while a tab is fully closed.
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

let watcherId = null;

// Starts (once) or replaces the single background watcher, forwarding every
// fix to `onLocation({ lat, lng, accuracy, at })`. `distanceFilter` keeps
// this to genuine movement instead of GPS jitter, since a `useEffect`
// mistake anywhere upstream can only call this so often. Safe to call again
// while already running -- the old watcher is stopped first.
export async function startBackgroundLocation(onLocation) {
  await stopBackgroundLocation();
  try {
    watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: 'Landmark Hunters',
        backgroundMessage: "Learning your taste as you travel -- tap to open the app.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 150,
      },
      (location, error) => {
        if (error) {
          // NOT_AUTHORIZED here (permission revoked after the fact, e.g. from
          // iOS Settings) isn't this call's problem to fix -- the caller
          // decides what to do (see useBackgroundLocationSync.js).
          console.error('[BackgroundLocation]', error);
          return;
        }
        if (location) {
          onLocation({
            lat: location.latitude,
            lng: location.longitude,
            accuracy: location.accuracy,
            at: location.time || Date.now(),
          });
        }
      }
    );
  } catch (err) {
    console.error('[BackgroundLocation] failed to start:', err);
    watcherId = null;
  }
}

export async function stopBackgroundLocation() {
  if (watcherId == null) return;
  const id = watcherId;
  watcherId = null;
  try {
    await BackgroundGeolocation.removeWatcher({ id });
  } catch {
    /* watcher already gone */
  }
}

// The onboarding/Settings "Always Allow Location" button: adds a throwaway
// watcher just to trigger iOS's permission dialog (When In Use, then
// Always), waits briefly for the plugin to report whether it was granted,
// then tears the watcher down -- useBackgroundLocationSync.js starts the
// real one once the preference is saved. Returns true only if a fix (or at
// least no NOT_AUTHORIZED error) came back in time.
export async function requestAlwaysPermission() {
  let authorized = true;
  let id = null;
  try {
    id = await BackgroundGeolocation.addWatcher({ requestPermissions: true, stale: true }, (location, error) => {
      if (error) authorized = false;
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } catch {
    authorized = false;
  } finally {
    if (id != null) {
      try {
        await BackgroundGeolocation.removeWatcher({ id });
      } catch {
        /* already gone */
      }
    }
  }
  return authorized;
}
