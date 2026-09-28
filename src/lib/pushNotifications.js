import { FirebaseMessaging } from '@capacitor-firebase/messaging';

// Real push notifications (dual-streak nudges, day-close reminders, etc.) --
// unlike anything else Firebase-related in this app, sending one needs a
// real service-account secret server-side (see api/_lib/firebaseAdmin.js),
// since FCM's send API has no public-key equivalent the way ID-token
// verification does. This file is just the device side: permission, the FCM
// token, and the listeners -- see usePushNotificationsSync.js for how it's
// wired to the traveler's own on/off preference.

export async function requestPushPermission() {
  const status = await FirebaseMessaging.checkPermissions();
  if (status.receive === 'granted') return true;
  const asked = await FirebaseMessaging.requestPermissions();
  return asked.receive === 'granted';
}

// Registers this device and returns its FCM token -- the id
// api/_lib/push.js sends to, stored per-device (see savePushToken in
// friends.js) so signing in on a second phone doesn't stop notifications on
// the first.
export async function getPushToken() {
  const { token } = await FirebaseMessaging.getToken();
  return token;
}

export async function deletePushToken() {
  await FirebaseMessaging.deleteToken();
}

let handles = [];

// FCM can reissue a device's token at any time (not just once) -- this is
// what keeps Firestore's copy current for as long as notifications stay on.
export async function listenForTokenRefresh(onToken) {
  const h = await FirebaseMessaging.addListener('tokenReceived', (event) => onToken(event.token));
  handles.push(h);
}

export async function removePushListeners() {
  await Promise.all(handles.map((h) => h.remove()));
  handles = [];
}
