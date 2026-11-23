// What the account's one paying check-in is worth (paid by the server,
// api/verify-checkin.js, once the visit is verified). Its own file so the
// API can import it under plain Node.
export const POINTS_PER_CHECKIN = 100;

// No check-in points within this distance of the account's saved home
// (anti-farming item 6, on again 2026-11-23): decided by the server
// (api/_lib/checkinPayout.js) from the home it keeps, never the phone's word.
export const HOME_RADIUS_METERS = 804.672; // 0.5 miles
export const HOME_RADIUS_EXCLUSION_ENABLED = true;
