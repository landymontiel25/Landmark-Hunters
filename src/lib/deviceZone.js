// The phone's IANA time zone ("America/New_York"), sent with every streak
// call so the server can pin it (api/_lib/streakClock.js). The server keeps
// the day itself; this only says where the phone is.
export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
