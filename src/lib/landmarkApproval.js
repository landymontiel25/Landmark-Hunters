// User-added landmarks are moderated again (anti-farming item 6, owner
// 2026-11-23): a new submission waits for the owner's approval (the admin
// dashboard's Content page) before anyone else sees it, it appears in Mapr
// or a check-in there can be verified. Its submitter sees it meanwhile,
// marked pending.
//
// Everything submitted before MODERATION_CUTOFF_MS was already live for
// everyone, so it stays approved (grandfathered) without touching the data;
// the owner can still reject one.
export const MODERATION_CUTOFF_MS = 1795417200000; // 2026-11-23 07:00 UTC

const msOf = (t) =>
  typeof t?.toMillis === 'function' ? t.toMillis() : Number.isFinite(t?.seconds) ? t.seconds * 1000 : Number.isFinite(t) ? t : Date.parse(t?.value || t) || NaN;

export function isApprovedLandmark(l) {
  if (!l) return false;
  if (l.status === 'approved') return true;
  if (l.status !== 'pending') return false;
  const at = msOf(l.createdAt);
  return Number.isFinite(at) && at < MODERATION_CUTOFF_MS;
}
