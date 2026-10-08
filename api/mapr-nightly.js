import { secretOk } from './_lib/secretOk.js';
import { adminDb, SERVICE_ACCOUNT_MISSING } from './_lib/firebaseAdmin.js';
import { ensureServerPlacePacks } from './_lib/placePacks.js';
import { loadStatsData } from './_lib/statsData.js';
import { runDaily, runWeekly } from './_lib/maprNightly.js';
import { RETRAIN_WEEKDAY } from '../src/lib/maprRank/config.js';

// Mapr Phase 1 nightly job (vercel.json "crons", 00:23 UTC). Same guard as
// api/study-summary.js: only Vercel's cron call, which carries
// `Authorization: Bearer ${CRON_SECRET}`, gets through.
//   every night   daily metrics report, Slack message, stagnation flags
//   Mondays       + similarity matrix, NCF retrain, trending (weekly models)
// `?weekly=1` runs the weekly part on any day (same secret), e.g. the first
// time, so the models exist before the next Monday.
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'CRON_SECRET is not set in Vercel, so the Mapr nightly job cannot run.' });
    return;
  }
  if (!secretOk(req.headers?.authorization, secret)) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const db = adminDb();
    const now = Date.now();
    const weekly = new Date(now).getUTCDay() === RETRAIN_WEEKDAY || String(req.query?.weekly || '') === '1';
    const ds = await loadStatsData(db);
    let models = null;
    if (weekly) {
      await ensureServerPlacePacks();
      models = await runWeekly(db, { now, ds });
    }
    const daily = await runDaily(db, { now, ds });
    res.status(200).json({ ok: true, daily, models, truncated: ds.truncated });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes(SERVICE_ACCOUNT_MISSING)) {
      res.status(503).json({ error: 'FIREBASE_SERVICE_ACCOUNT is not set in Vercel, so the Mapr nightly job cannot run.' });
      return;
    }
    console.error('mapr-nightly failed:', msg);
    res.status(500).json({ error: 'The Mapr nightly job failed.' });
  }
}
