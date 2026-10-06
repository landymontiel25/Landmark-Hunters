'use client';
import type { MaprArmsGain, MaprExperiment, MaprNCFModel } from '@/lib/types';
import { num, pct, when } from '@/lib/metrics';

// Mapr v2 rollout (FEATURES.maprV2 in src/lib/maprRank/config.js): the v2
// model's holdout accuracy next to v1's, and the live A/B overall, for new
// users and per region. Gains are treatment minus control, in points.
const ROLLOUT_PERCENT = 20;

const points = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} pts`);
const stars = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${num(v, 2)}`);

function GainRow({ label, g }: { label: string; g: MaprArmsGain | undefined }) {
  if (!g) return null;
  return (
    <tr className="border-t border-black/5 dark:border-white/10">
      <td className="py-1 pr-2">{label}</td>
      <td className="py-1 pr-2">
        {g.control.shown} / {g.treatment.shown}
      </td>
      <td className="py-1 pr-2">
        {pct(g.control.ctr)} → {pct(g.treatment.ctr)} <span className="secondary">({points(g.gain.ctr)})</span>
      </td>
      <td className="py-1 pr-2">
        {pct(g.control.visitLoveRate)} → {pct(g.treatment.visitLoveRate)} <span className="secondary">({points(g.gain.visitLoveRate)})</span>
      </td>
      <td className="py-1">
        {num(g.control.avgPickRating, 2)} → {num(g.treatment.avgPickRating, 2)} <span className="secondary">({stars(g.gain.avgPickRating)})</span>
      </td>
    </tr>
  );
}

export function MaprV2Rollout({ ab, model, loading }: { ab: MaprExperiment | undefined; model: MaprNCFModel | null; loading: boolean }) {
  const v2 = model?.v2;
  const regions = Object.entries(ab?.byRegion || {});
  return (
    <section className="card p-4 space-y-3" aria-label="Mapr v2 rollout">
      <h2 className="font-medium">Mapr v2 rollout · {ROLLOUT_PERCENT}% of users</h2>
      <p className="text-sm secondary">
        Training on logits, same-city negatives and early stopping on accuracy, ranked with 0.8 × tag score + 0.2 × NCF. NCF only ranks once the model is on (more than {model?.active_threshold ?? 10} active users); until then both arms rank the same.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular">
          <thead>
            <tr className="secondary text-left">
              <th className="py-1 pr-2 font-normal">Holdout accuracy</th>
              <th className="py-1 pr-2 font-normal">Any place</th>
              <th className="py-1 pr-2 font-normal">Same region</th>
              <th className="py-1 font-normal">Last run</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-black/5 dark:border-white/10">
              <td className="py-1 pr-2">v1 (today)</td>
              <td className="py-1 pr-2">{pct(model?.test_accuracy_catalog ?? model?.test_accuracy)}</td>
              <td className="py-1 pr-2">{pct(model?.test_accuracy_region)}</td>
              <td className="py-1">{model ? `${when(model.last_run)} (${model.last_action || '—'})` : '—'}</td>
            </tr>
            <tr className="border-t border-black/5 dark:border-white/10">
              <td className="py-1 pr-2">v2</td>
              <td className="py-1 pr-2">{pct(v2?.test_accuracy_catalog)}</td>
              <td className="py-1 pr-2">{pct(v2?.test_accuracy_region)}</td>
              <td className="py-1">{v2 ? `${when(v2.last_run)} (${v2.last_action || '—'}${v2.active ? ', on' : ', off'})` : 'Not trained yet'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {ab?.started ? (
        <>
          <p className="text-sm">
            Day {ab.days} · CTR p={ab.ctr.pValue ?? '—'} {ab.ctr.significant ? '(significant)' : '(not yet)'} · {ab.decision} · v2 model ranked {pct(ab.servedV2Share, 0)} of treatment picks
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular">
              <thead>
                <tr className="secondary text-left">
                  <th className="py-1 pr-2 font-normal">Segment</th>
                  <th className="py-1 pr-2 font-normal">Picks (v1 / v2)</th>
                  <th className="py-1 pr-2 font-normal">Tap rate</th>
                  <th className="py-1 pr-2 font-normal">Visited and loved</th>
                  <th className="py-1 font-normal">Avg rating</th>
                </tr>
              </thead>
              <tbody>
                <GainRow label="Everyone" g={ab.overall} />
                <GainRow label={`New users (under ${ab.newUserRatings ?? 5} ratings)`} g={ab.newUsers} />
                <GainRow label="Established users" g={ab.established} />
                {regions.map(([region, g]) => (
                  <GainRow key={region} label={region} g={g} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="text-sm muted">{loading ? 'Loading…' : 'No v2 picks shown yet. The A/B starts with the first pick a v2 user sees.'}</p>
      )}
    </section>
  );
}
