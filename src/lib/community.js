// The discovery network's launch area (docs/discovery-network-plan.md):
// Philadelphia plus Villanova, as one area. Community picks (Phase 3), the
// ramp and the density gate run only in these regions; everywhere else the
// app stays Mapr only.
export const COMMUNITY_REGIONS = ['philly', 'villanova'];

const DAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVE_DAYS = 30;

// People who rated or checked in during the last 30 days, in `regions`
// (all regions when null). ds is the nightly job's statsData.
export function activeUsers(ds, { nowMs = Date.now(), regions = null, canonical = (r) => r } = {}) {
  const from = nowMs - ACTIVE_DAYS * DAY_MS;
  const inRegion = (r) => !regions || (r && regions.includes(canonical(r)));
  const out = new Set();
  for (const c of ds.checkins || []) if (c.userId && Number.isFinite(c.createdAt) && c.createdAt >= from && c.createdAt <= nowMs && inRegion(c.region)) out.add(c.userId);
  for (const r of ds.reviews || []) {
    const at = r.ratedAt ?? r.updatedAt ?? r.createdAt ?? null;
    if (r.userId && Number.isFinite(at) && at >= from && at <= nowMs && inRegion(r.region)) out.add(r.userId);
  }
  return out;
}
