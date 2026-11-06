import { getRegion, canonicalRegionId } from '../data/regions';
import { rankOf } from './leaderboard';
import { isRealCheckin } from './realCheckin';
import { levelForPoints } from './level';
import { displayStreakCount } from './streaks';

// Pure pieces of a friend's full profile (screens/FriendProfile.jsx): the
// formatting and the leaderboard lookup, no reads of their own.

// Shown for any value we don't have; the row stays.
export const MISSING = '–';

const DATE = { month: 'short', day: 'numeric', year: 'numeric' };

// users/{uid}.createdAt: a Firestore Timestamp ({ seconds }), or epoch ms
// from an older backfill.
export function joinedText(createdAt) {
  const ms = createdAt?.seconds != null ? createdAt.seconds * 1000 : Number.isFinite(createdAt) ? createdAt : null;
  return ms ? new Date(ms).toLocaleDateString(undefined, DATE) : MISSING;
}

// Lifetime points (getUserStats) -> the trainer level Full Stats shows.
export const levelText = (stats) => (Number.isFinite(stats?.totalPoints) ? String(levelForPoints(stats.totalPoints)) : MISSING);

// How many countries the cities a friend checked into are in.
export function countriesOf(cityIds) {
  if (!Array.isArray(cityIds)) return null;
  return new Set(cityIds.map((id) => getRegion(canonicalRegionId(id))?.country).filter(Boolean)).size;
}

export const countText = (n) => (Number.isFinite(n) ? n.toLocaleString() : MISSING);

// The friend's points and rank on the friends leaderboard (Profile's Friends
// tab and this page read the same leaderboard_entries, so both show the same
// number). entries: getFriendsLeaderboard's points-sorted list.
export function friendStanding(entries, uid) {
  if (!Array.isArray(entries)) return { points: MISSING, rank: MISSING };
  const idx = entries.findIndex((e) => e.userId === uid);
  if (idx < 0 || !Number.isFinite(entries[idx].points)) return { points: MISSING, rank: MISSING };
  return { points: entries[idx].points.toLocaleString(), rank: `#${rankOf(entries, idx)} of ${entries.length}` };
}

// The newest real visit (a "Rate a Landmark" claim isn't one), as text.
export function lastCheckin(checkins) {
  const c = Array.isArray(checkins) ? checkins.find(isRealCheckin) : null;
  if (!c) return { name: MISSING, city: MISSING, date: MISSING };
  const sec = c.createdAt?.seconds;
  return {
    name: c.landmarkName || MISSING,
    city: (c.region && getRegion(canonicalRegionId(c.region))?.name) || MISSING,
    date: sec ? new Date(sec * 1000).toLocaleDateString(undefined, DATE) : MISSING,
  };
}

// A solo streak still alive on this phone's calendar day, else 0.
export const soloStreakDays = (streak, now = new Date()) => (streak ? displayStreakCount(streak, now) : 0);
