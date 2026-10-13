// Milliseconds from whatever Firestore hands back for a time: a number, an
// Admin SDK Timestamp, or a plain { seconds } / { _seconds } object.
// Null for anything else.
export const toMs = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  if (v && typeof v.seconds === 'number') return v.seconds * 1000;
  if (v && typeof v._seconds === 'number') return v._seconds * 1000;
  return null;
};
