// The feed (docs/discovery-network-plan.md, Phase 6): 30 items for a city,
// tips first in Mapr's order, with three mixing rules:
//   at most 2 in a row from one finder
//   at most 1 in 5 from people you follow (so the feed isn't only them)
//   every 6th slot is one of Mapr's own picks, "Mapr thinks you'd like"
// Pure, so api/feed.js and its tests agree.

export const FEED_SIZE = 30;
export const MAPR_EVERY = 6;
export const FOLLOWED_SHARE = 5; // at most 1 in 5
export const SAME_FINDER_RUN = 2;
export const FEED_SURFACE = 'feed';

// tipItems: best first, each { key, finderUid, followed }.
// maprItems: best first, each { key }. Returns the mixed list.
export function composeFeed(tipItems, maprItems, { size = FEED_SIZE } = {}) {
  const tips = [...(tipItems || [])];
  const mapr = [...(maprItems || [])];
  const used = new Set();
  const out = [];
  let followed = 0;
  const runOf = (uid) => {
    let n = 0;
    for (let i = out.length - 1; i >= 0 && out[i].finderUid === uid; i--) n++;
    return n;
  };
  while (out.length < size && (tips.length || mapr.length)) {
    const slot = out.length + 1;
    const takeMapr = () => {
      const i = mapr.findIndex((m) => !used.has(m.key));
      if (i < 0) return false;
      const [m] = mapr.splice(i, 1);
      used.add(m.key);
      out.push({ ...m, kind: 'mapr' });
      return true;
    };
    if (slot % MAPR_EVERY === 0 && takeMapr()) continue;
    // The best tip that keeps the rules; a followed one only while under
    // 1 in 5 of the slots so far (counting this one).
    const i = tips.findIndex((t) => !used.has(t.key) && runOf(t.finderUid) < SAME_FINDER_RUN && (!t.followed || (followed + 1) * FOLLOWED_SHARE <= slot + FOLLOWED_SHARE - 1));
    if (i >= 0) {
      const [t] = tips.splice(i, 1);
      used.add(t.key);
      if (t.followed) followed++;
      out.push({ ...t, kind: 'tip' });
      continue;
    }
    // No tip fits here: one of Mapr's picks instead, else stop.
    if (!takeMapr()) break;
  }
  return out;
}
