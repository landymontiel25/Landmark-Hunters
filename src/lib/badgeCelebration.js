// Picks the badges to celebrate now, and claims them in `claimed` (a Set kept
// for the session) in the same step, before any async write starts.
//
// The badge list recomputes many times while a new device loads (stats,
// streak, extras and friends all arrive separately), and each recompute
// re-ran the "what's new" check. With the Firestore write for the first run
// still in flight, every re-run found the same badge still missing from the
// profile and started another write; each one queued the popup again when it
// resolved, after the person had already dismissed it. Claiming synchronously
// means a badge is written and queued once per session, however often this
// runs.
export function claimFreshBadges({ badges, known, uid, celebrated, claimed }) {
  const fresh = badges.filter((b) => !known[b.id] && !celebrated(uid, b.id) && !claimed.has(`${uid}.${b.id}`));
  for (const b of fresh) claimed.add(`${uid}.${b.id}`);
  return fresh;
}

// The write failed, so nothing was celebrated: let a later run try again.
export function releaseBadges({ badges, uid, claimed }) {
  for (const b of badges) claimed.delete(`${uid}.${b.id}`);
}
