'use client';
import { useState } from 'react';
import { Page } from '@/components/Page';

// The admin tools that used to be on the app's Admin stats page. Each button
// asks this dashboard's server, which calls the app's api/admin-jobs.js with
// the shared secret.
const TOOLS = [
  { action: 'mapr-run', title: 'Mapr: run now', text: 'Runs the nightly job now, weekly models included: similarity matrix, NCF training, the daily report, every dashboard collection, and the Slack message. Takes up to a minute.' },
] as const;

export default function Tools() {
  const [state, setState] = useState<Record<string, { running: boolean; text: string }>>({});
  const run = async (action: string) => {
    setState((s) => ({ ...s, [action]: { running: true, text: 'Running…' } }));
    try {
      const r = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Failed (${r.status}).`);
      setState((s) => ({ ...s, [action]: { running: false, text: JSON.stringify(body, null, 2) } }));
    } catch (e) {
      setState((s) => ({ ...s, [action]: { running: false, text: String((e as Error).message || e) } }));
    }
  };
  return (
    <Page title="Tools" subtitle="Admin jobs. Results show below the button. The dashboard also refreshes its numbers by itself every few minutes while it is open.">
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {TOOLS.map((t) => (
          <section key={t.action} className="card p-4 space-y-3" aria-label={t.title}>
            <h2 className="font-medium">{t.title}</h2>
            <p className="text-sm secondary">{t.text}</p>
            <button type="button" className="btn btn-primary" disabled={state[t.action]?.running} onClick={() => run(t.action)}>
              {state[t.action]?.running ? 'Running…' : 'Run'}
            </button>
            {state[t.action]?.text && (
              <pre role="status" className="text-xs whitespace-pre-wrap break-words p-2 rounded max-h-64 overflow-auto" style={{ background: 'var(--surface-2)' }}>
                {state[t.action].text}
              </pre>
            )}
          </section>
        ))}
      </div>
    </Page>
  );
}
