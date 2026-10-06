import type { AppMetricCard } from './types';

// The five numbers on the "Horowitz Andreesen Academy" tab. Each is read from
// the app's own metrics (app_metrics/latest), shown with how many people it
// is based on, and left as "Not measured yet" when the app has no data for it.
// Nothing here is typed in by hand.

export const MATCH_TARGET_PCT = 75;

export interface AcademyRow {
  label: string;
  value: string;
  detail?: string;
  status?: AppMetricCard['status'];
}
export interface AcademyCard {
  key: string;
  question: string;
  title: string;
  rows: AcademyRow[];
  status: AppMetricCard['status'];
  table?: { label: string; active: number; newUsers: number }[];
  note?: string;
}

const find = (ms: AppMetricCard[], id: string) => ms.find((m) => m.id === id);
const num = (m?: AppMetricCard) => (m && typeof m.value === 'number' ? m.value : null);
const shown = (m: AppMetricCard | undefined, digits = 1) => (num(m) == null ? 'Not measured yet' : `${Number(num(m)!.toFixed(digits))}${m?.unit || ''}`);
const basedOn = (m?: AppMetricCard) => (m && m.n != null ? `${m.n} ${m.nLabel || 'users'}` : undefined);

export function academyCards(metrics: AppMetricCard[]): AcademyCard[] {
  const match = find(metrics, 'matchRate');
  const matchVal = num(match);
  const base = match?.baseline;
  const d1 = find(metrics, 'retentionD1');
  const d7 = find(metrics, 'retentionD7');
  const d30 = find(metrics, 'retentionD30');
  const weekly = find(metrics, 'weeklyUsers');
  const rpw = find(metrics, 'ratingsPerActiveUserWeek');
  const viral = find(metrics, 'viralSignupRate');
  const retentionStatus = (m?: AppMetricCard) => (m?.status === 'met' || m?.status === 'missed' ? m.status : 'unknown');
  return [
    {
      key: 'match',
      question: 'Does Mapr predict what people like?',
      title: 'Mapr match rate',
      status: matchVal == null ? 'unknown' : matchVal >= MATCH_TARGET_PCT ? 'met' : 'missed',
      rows: [
        { label: 'Picks users rated positively', value: shown(match), detail: `Target ${MATCH_TARGET_PCT}% · based on ${basedOn(match) ?? 'no users yet'}` },
        ...(base ? [{ label: base.label || 'Baseline', value: `${Number(base.value.toFixed(1))}${base.unit || '%'}` }] : []),
      ],
      note: matchVal == null ? match?.note || 'Needs users with 10 or more ratings on Mapr picks.' : undefined,
    },
    {
      key: 'retention',
      question: 'Do people come back?',
      title: 'Retention',
      status: 'unknown',
      rows: [
        { label: 'Day 1', value: shown(d1), detail: basedOn(d1), status: retentionStatus(d1) },
        { label: 'Day 7', value: shown(d7), detail: basedOn(d7), status: retentionStatus(d7) },
        { label: 'Day 30', value: shown(d30), detail: basedOn(d30), status: retentionStatus(d30) },
      ],
      note: [d1, d7, d30].every((m) => num(m) == null) ? 'Needs users whose day 1, 7 or 30 has passed since open tracking began.' : undefined,
    },
    {
      key: 'users',
      question: 'Do people use the app, and is the number growing?',
      title: 'Active users and new users per week',
      status: 'unknown',
      rows: weekly
        ? [
            { label: 'Active users, last 7 days', value: shown(weekly, 0), detail: 'Opened the app or rated in the last 7 days' },
            { label: 'New users, last 7 days', value: weekly.newUsers == null ? 'Not measured yet' : String(weekly.newUsers), detail: basedOn(weekly) ? `${weekly.n} ${weekly.nLabel} so far` : undefined },
          ]
        : [{ label: 'Active users, last 7 days', value: 'Not measured yet' }],
      table: weekly?.weekly?.map((w) => ({ label: w.weekEnding, active: w.active, newUsers: w.newUsers })),
      note: 'Counts of people, not percentages, so a small sample reads as it is.',
    },
    {
      key: 'ratings',
      question: 'Is Mapr collecting the taste data that improves it?',
      title: 'Ratings per active user per week',
      status: 'unknown',
      rows: [{ label: 'Last 7 days', value: shown(rpw, 2), detail: basedOn(rpw) ? `Based on ${basedOn(rpw)}` : undefined }],
      note: num(rpw) == null ? rpw?.note : undefined,
    },
    {
      key: 'invite',
      question: 'Can the app grow by word of mouth?',
      title: 'Invite rate',
      status: viral?.status === 'met' || viral?.status === 'missed' ? viral.status : 'unknown',
      rows: [{ label: 'New users who came through a friend', value: shown(viral), detail: viral?.goal ? `Goal ${viral.goal} · based on ${basedOn(viral) ?? 'no users yet'}` : basedOn(viral) }],
      note: num(viral) == null ? viral?.note : undefined,
    },
  ];
}
