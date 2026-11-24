// Who can approve/reject a submitted landmark before it goes live. Plain
// email allowlist for now -- simplest thing that works for a couple of
// trusted people; swap for a real roles system later if this grows.
// This list is for the UI only (showing/hiding the review screen) -- the
// actual enforcement lives in firestore.rules' `custom_landmarks` `update`
// rule, which has its own copy of this same list. Keep both in sync.
export const ADMIN_EMAILS = ['landymontiel25@gmail.com'];

// Check in from anywhere (owner, 2026-11-23): the admin's own check-ins
// skip the radius, on the phone and on the server (api/verify-checkin.js),
// and still verify and pay; mission photos skip the "taken here" location
// check (the AI still judges what's in the photo). Everyone else is
// unchanged. It's the "Check-in radius off" switch in the admin panel,
// stored in admin_settings/{uid}.checkinAnywhere (on until switched off);
// AdminModeContext keeps this copy in step with it.
let checkinAnywhereLive = true;
export function setCheckinAnywhereLive(on) {
  checkinAnywhereLive = on !== false;
}

export const checksInAnywhere = (user) => isAdmin(user?.email) && checkinAnywhereLive;

export function isAdmin(email) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}
