// The words a community pick shows (Phase 3): who found it and what they
// are to you. Never a weight, ramp or score.
export function foundByLine(pick) {
  const c = pick?.community;
  const f = c?.likeYou ? c.finder : null;
  if (!f?.name) return null;
  const why = f.match ? `Taste match: ${f.match}` : f.relation === 'follow' ? 'you follow them' : f.relation === 'friend' ? 'your friend' : null;
  return `Found by ${f.name} · verified visit${why ? ` · ${why}` : ''}`;
}

// Places in `places` that people like you found (a taste neighbor, someone
// you follow, a friend), from the Mapr models' community data.
export function foundByPeopleLikeYou(places, community) {
  if (!community) return [];
  return (places || []).filter((p) => community[p.regionId || p.region]?.places?.[p.id]?.likeYou === true);
}

// The "Found by people like you" row shows only with this many.
export const FOUND_ROW_MIN = 3;
