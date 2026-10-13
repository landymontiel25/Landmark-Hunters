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
          {latest.neighbors_active != null && (
            <p className="text-xs muted mt-1">
              Taste neighbors: {latest.neighbors_with_any ?? 0} of {latest.neighbors_active} active people have at least one (score 0.3 or more) · {latest.neighbors_with_high ?? 0} have a High match
            </p>
          )}
        </section>
      )}
      <TrendChart title="Follows" data={(metrics.data || []) as unknown as Record<string, unknown>[]} series={[{ key: 'follows_total', label: 'Follows' }, { key: 'new_follows', label: 'New' }]} format={(v) => String(Math.round(v))} />
      <TrendChart title="People with a taste neighbor" data={(metrics.data || []) as unknown as Record<string, unknown>[]} series={[{ key: 'neighbors_with_any', label: 'Any' }, { key: 'neighbors_with_high', label: 'High' }]} format={(v) => String(Math.round(v))} />
      <TrendChart title="Launch area following a discoverer" data={(metrics.data || []) as unknown as Record<string, unknown>[]} series={[{ key: 'launch_follow_rate', label: 'Share' }]} format={(v) => pct(v)} />
    </Page>
  );
}
