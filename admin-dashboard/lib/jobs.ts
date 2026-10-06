// The Tools page's buttons, forwarded by app/api/jobs/route.ts to the main
// app's api/admin-jobs.js with ADMIN_JOBS_SECRET (server to server; the
// secret never reaches the browser). Only these actions pass through.
export const JOB_ACTIONS = ['mapr-run', 'refresh'] as const;
export type JobAction = (typeof JOB_ACTIONS)[number];

export async function forwardJob(action: unknown, { appUrl = process.env.APP_URL, secret = process.env.ADMIN_JOBS_SECRET, fetchImpl = fetch } = {}): Promise<{ status: number; body: unknown }> {
  if (!JOB_ACTIONS.includes(action as JobAction)) return { status: 400, body: { error: 'Unknown action.' } };
  if (!appUrl || !secret) return { status: 503, body: { error: 'APP_URL and ADMIN_JOBS_SECRET must be set on the dashboard.' } };
  try {
    const r = await fetchImpl(`${appUrl.replace(/\/$/, '')}/api/admin-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action }),
    });
    const text = await r.text().catch(() => '');
    try {
      return { status: r.status, body: JSON.parse(text) };
    } catch {
      // Not the app's own JSON: usually Vercel (Deployment Protection) or a wrong address.
      const host = new URL(appUrl).host;
      const said = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      const hint = r.status === 401 || r.status === 403 ? ' Vercel Deployment Protection may be blocking server requests, or APP_URL points at the wrong deployment.' : '';
      return { status: r.status, body: { error: `${host} answered ${r.status}${said ? ` (“${said}”)` : ' with no message'}.${hint}` } };
    }
  } catch (e) {
    return { status: 502, body: { error: `Could not reach the app: ${String((e as Error)?.message || e)}` } };
  }
}
