import { haversineMeters } from './haversine';
import { radiusFor } from './checkinRules';
import { readExif } from './exif';
import { Camera, CameraDirection, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';

// Photo missions, first version (owner, 2026-11-16): the photo has to be
// taken at the landmark, inside its check-in radius, during this visit,
// after checking in. Checked on the phone: the camera opens straight away
// (never the photo library), then the photo's own GPS and time are read;
// a phone that strips them (iPhone does for web uploads) is checked on
// the live GPS fix and clock at the moment the photo came back from the
// camera instead. Anything that fails gets a plain "retake it here" note.

// A camera photo is "fresh" when it's this new.
export const FRESH_MS = 2 * 60 * 1000;
// Small clock differences between the camera and the check-in.
const SLACK_MS = 60 * 1000;
// One visit: the same day as the check-in, and no more than this long after.
export const VISIT_MS = 12 * 60 * 60 * 1000;

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// Pure. photo: { lat, lng, takenAt } from EXIF (any may be null),
// fileTime: the file's lastModified, device: { lat, lng, accuracy, at } (the
// live fix taken right after the camera closed, or null).
export function checkMissionPhoto({ landmark, checkedInAt, photo = {}, fileTime = null, device = null, now = Date.now() }) {
  const name = landmark?.name || 'the landmark';
  const retake = `Retake it at ${name}.`;
  if (!Number.isFinite(checkedInAt)) return { ok: false, reason: 'no-checkin', message: `Check in at ${name} first, then take the mission photo there.` };

  // Where: the photo's GPS, else the live fix (only for a photo just taken).
  const takenAt = Number.isFinite(photo.takenAt) ? photo.takenAt : Number.isFinite(fileTime) ? fileTime : null;
  const fresh = takenAt != null && now - takenAt <= FRESH_MS && takenAt <= now + SLACK_MS;
  let where = null;
  if (Number.isFinite(photo.lat) && Number.isFinite(photo.lng)) where = { lat: photo.lat, lng: photo.lng, accuracy: 0 };
  else if (fresh && device && Number.isFinite(device.lat) && Number.isFinite(device.lng) && now - (device.at ?? 0) <= FRESH_MS) where = device;
  if (!where) return { ok: false, reason: 'no-location', message: `This photo has no location, so I can't tell where it was taken. ${retake}` };

  // When: after this check-in, during this visit.
  if (takenAt == null) return { ok: false, reason: 'no-time', message: `This photo has no time on it. ${retake}` };
  if (takenAt < checkedInAt - SLACK_MS) return { ok: false, reason: 'before-checkin', message: `This photo was taken before you checked in. ${retake}` };
  if (takenAt > now + SLACK_MS || takenAt - checkedInAt > VISIT_MS || !sameDay(takenAt, checkedInAt)) {
    return { ok: false, reason: 'other-visit', message: `This photo is from a different visit. ${retake}` };
  }

  const radius = radiusFor(landmark);
  // A loose fix gets a little room, never more than the radius itself.
  const slack = Math.min(radius, Math.max(0, Number(where.accuracy) || 0));
  const meters = haversineMeters(where.lat, where.lng, landmark.lat, landmark.lng);
  if (meters > radius + slack) return { ok: false, reason: 'too-far', message: `This photo was taken somewhere else. ${retake}` };
  return { ok: true };
}

// Opens the camera (never the library), reads the photo's EXIF, and gets a
// live GPS fix. Returns { file, photo, fileTime, device } for
// checkMissionPhoto, or null when the camera was closed without a photo.
export async function takeMissionPhoto() {
  let shot;
  try {
    shot = await Camera.getPhoto({
      quality: 85,
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
      direction: CameraDirection.Rear,
      saveToGallery: false,
      webUseInput: true,
    });
  } catch (e) {
    if (/denied|not.?authori[sz]ed|permission/i.test(String(e?.message || e || ''))) {
      const err = new Error('Camera access is off. Turn it on in Settings to do photo missions.');
      err.userMessage = err.message;
      throw err;
    }
    return null;
  }
  if (!shot?.webPath) return null;
  const closedAt = Date.now();
  const device = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 })
    .then((p) => ({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }))
    .catch(() => null);
  let blob;
  try {
    blob = await (await fetch(shot.webPath)).blob();
  } finally {
    if (shot.webPath.startsWith('blob:')) URL.revokeObjectURL(shot.webPath);
  }
  const photo = readExif(await blob.arrayBuffer());
  // The web camera hands back a File (lastModified = when it was taken);
  // the native camera a fresh capture, so the moment it closed.
  const fileTime = Number.isFinite(blob.lastModified) ? blob.lastModified : closedAt;
  const file = new File([blob], `mission.${shot.format || 'jpeg'}`, { type: blob.type || 'image/jpeg' });
  return { file, photo, fileTime, device };
}
