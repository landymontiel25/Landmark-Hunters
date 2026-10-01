// uid-timestamp-random: stable for one built set, unique across sets.
export function makeSetId(uid, at = Date.now()) {
  return `${uid}-${at}-${Math.random().toString(36).slice(2, 8)}`;
}
