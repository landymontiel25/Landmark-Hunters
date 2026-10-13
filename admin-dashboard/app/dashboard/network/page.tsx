'use client';
import { Page } from '@/components/Page';
import { TrendChart } from '@/components/Chart';
import { ListenerError } from '@/components/AlertBanner';
import { useNetworkMetrics } from '@/lib/listeners';

// The discovery network (docs/discovery-network-plan.md, Phases 2 to 6),
// from network_metrics/{date}, written by the app's nightly job. Counts
// only: no names, no uids.

const pct = (v: number | null | undefined) => (v == null ? 'n/a' : `${Math.round(v * 100)}%`);

export default function Network() {
  const metrics = useNetworkMetrics(30);
  const latest = metrics.data?.[metrics.data.length - 1];
  return (
    <Page title="Network" subtitle="Follows and the launch area (Philadelphia plus Villanova). Phase 2 is done when 60% of active people there follow a discoverer.">
      <ListenerError error={metrics.error} />
      {!latest && !metrics.error && <p className="text-sm muted">No network numbers yet. The nightly job writes them.</p>}
      {latest && (
        <section className="card p-4" aria-label="Network today">
          <p className="font-medium">Follows ({latest.date})</p>
          <p className="text-sm secondary mt-1">
            {latest.follows_total ?? 0} follows · {latest.new_follows ?? 0} new that day · {latest.people_following ?? 0} people follow someone · {latest.people_followed ?? 0} people have a follower
          </p>
          <p className="text-xs muted mt-1">
            Launch area: {latest.launch_active ?? 0} active in the last 30 days · {latest.launch_following_discoverer ?? 0} follow a discoverer ({pct(latest.launch_follow_rate)}) · {latest.discoverers ?? 0} discoverers with a live tip
          </p>
          {latest.density_ramp != null && (
            <p className="text-xs muted mt-1">
              Density: ramp {pct(latest.density_ramp)} (lowest of {latest.density_active ?? 0}/100 active people and {latest.density_live_tips ?? 0}/150 live tips) · gate {latest.density_gate_open ? 'open' : 'closed'}, {latest.density_gate_days ?? 0}/14 days ·{' '}
              {latest.density_discoverers_30d ?? 0}/30 recent discoverers · {latest.density_tip_places ?? 0}/150 places with a tip · median {latest.density_median_nearby ?? 0}/5 nearby
            </p>
          )}
          {latest.community_picks_shown_30d != null && (
            <p className="text-xs muted mt-1">
              Last 30 days: {latest.community_picks_shown_30d} community picks shown (skip {pct(latest.community_skip_rate_30d)}, visit {pct(latest.community_visit_rate_30d)}) vs {latest.mapr_picks_shown_30d ?? 0} Mapr-only (skip {pct(latest.mapr_skip_rate_30d)}, visit {pct(latest.mapr_visit_rate_30d)})
            </p>
          )}
          {latest.influence_events != null && (
            <p className="text-xs muted mt-1">
              Reputation: {latest.influence_events} influence events ({latest.influence_new ?? 0} new) · {latest.went_7d ?? 0} went in the last 7 days · {latest.reputation_finders ?? 0} finders with a score ·{' '}
              {Object.entries(latest.reputation_levels || {}).map(([k, v]) => `${k.replace('_', ' ')} ${v}`).join(', ') || 'no levels yet'}
              {(latest.friend_heavy_finders ?? 0) > 0 && <strong> · {latest.friend_heavy_finders} finders get most events from friends (check for a ring)</strong>}
            </p>
          )}
          {latest.launch_d7_cohort != null && (
            <p className="text-xs muted mt-1">
              Feed: {latest.feed_items_shown_30d ?? 0} feed items shown in 30 days · day-7 retention of new people in the launch area {pct(latest.launch_d7_retention)} ({latest.launch_d7_cohort} people; compare before and after the gate opens)
            </p>
          )}
          {latest.loop_went_finders != null && (
            <p className="text-xs muted mt-1">
              Loop: {latest.loop_went_finders} discoverers got a &quot;tip went&quot; (14 to 44 days ago), {pct(latest.loop_went_repost_rate)} posted again within 14 days, vs {pct(latest.loop_other_repost_rate)} of {latest.loop_other_finders ?? 0} without one · alerts tonight {latest.alerts_nightly ?? 0} + {latest.alerts_nearby ?? 0} nearby
            </p>
          )}
          {latest.neighbors_active != null && (
            <p className="text-xs muted mt-1">
              Taste neighbors: {latest.neighbors_with_any ?? 0} of {latest.neighbors_active} active people have at least one (score 0.3 or more) · {latest.neighbors_with_high ?? 0} have a High match
            </p>
          )}
        </section>
      )}
      <TrendChart title="Follows" data={(metrics.data || []) as unknown as Record<string, unknown>[]} series={[{ key: 'follows_total', label: 'Follows' }, { key: 'new_follows', label: 'New' }]} format={(v) => String(Math.round(v))} />
      <TrendChart title="Went because of a tip (7 days)" data={(metrics.data || []) as unknown as Record<string, unknown>[]} series={[{ key: 'went_7d', label: 'Went' }]} format={(v) => String(Math.round(v))} />
      <TrendChart title="Day-7 retention, new people in the launch area" data={(metrics.data || []) as unknown as Record<string, unknown>[]} series={[{ key: 'launch_d7_retention', label: 'Day 7' }]} format={(v) => pct(v)} />
      <TrendChart title="Community ramp" data={(metrics.data || []) as unknown as Record<string, unknown>[]} series={[{ key: 'density_ramp', label: 'Ramp' }]} format={(v) => pct(v)} />
      <TrendChart title="People with a taste neighbor" data={(metrics.data || []) as unknown as Record<string, unknown>[]} series={[{ key: 'neighbors_with_any', label: 'Any' }, { key: 'neighbors_with_high', label: 'High' }]} format={(v) => String(Math.round(v))} />
      <TrendChart title="Launch area following a discoverer" data={(metrics.data || []) as unknown as Record<string, unknown>[]} series={[{ key: 'launch_follow_rate', label: 'Share' }]} format={(v) => pct(v)} />
    </Page>
  );
}
