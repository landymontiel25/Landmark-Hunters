// The words a community pick shows (Phase 3): who found it and what they
// are to you. Never a weight, ramp or score.
// Why this finder counts for you, in words (Mapr chat uses the same).
export function finderWhy(f) {
  if (!f) return null;
  if (f.match) return `Taste match: ${f.match}`;
  if (f.relation === 'follow') return 'you follow them';
  if (f.relation === 'friend') return 'your friend';
  // A Trusted or Insider finder in that city (Phase 4).
  return typeof f.levelLabel === 'string' ? f.levelLabel.slice(0, 60) : null;
}

export function foundByLine(pick) {
  const c = pick?.community;
  const f = c?.likeYou ? c.finder : null;
  if (!f?.name) return null;
  const why = finderWhy(f);
  return `Found by ${f.name} · verified visit${why ? ` · ${why}` : ''}`;
}

// Is this place a find by someone like you? One predicate for every surface.
export const isCommunityFind = (place, community) => community?.[place?.regionId || place?.region]?.places?.[place?.id]?.likeYou === true;

// Places in `places` that people like you found (a taste neighbor, someone
// you follow, a friend), from the Mapr models' community data.
export function foundByPeopleLikeYou(places, community) {
  if (!community) return [];
  return (places || []).filter((p) => isCommunityFind(p, community));
}

// The "Found by people like you" row shows only with this many.
export const FOUND_ROW_MIN = 3;
