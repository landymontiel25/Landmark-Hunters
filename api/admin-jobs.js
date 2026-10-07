import { timingSafeEqual } from 'node:crypto';
import { adminAuth, adminDb, SERVICE_ACCOUNT_MISSING } from './_lib/firebaseAdmin.js';
import { backfillCreatedAt } from './_lib/createdAtBackfill.js';
import { runPhotoBackfill } from './_lib/photoBackfill.js';
import { ensureServerPlacePacks } from './_lib/placePacks.js';
import { loadStatsData } from './_lib/statsData.js';
import { runDaily, runWeekly } from './_lib/maprNightly.js';
import { ALL_LANDMARKS } from '../src/data/regions.js';

// The owner's admin tools, now driven only by the separate admin dashboard
// (admin-dashboard/), server to server. The app itself has no admin stats
// page or route any more. The dashboard's server sends
// `Authorization: Bearer ${ADMIN_JOBS_SECRET}`; the secret never reaches a
// browser. With ADMIN_JOBS_SECRET unset this answers 503 (never open).
//   POST { action: 'mapr-run' }        Mapr nightly job now, weekly models included
//   POST { action: 'refresh' }         rebuild the dashboard numbers only: no model
//                                      training, no Slack message (auto-refresh)
//   POST { action: 'backfill' }        sign-up date backfill (users.createdAt)
//   POST { action: 'photo-backfill' }  one batch of the Google place-ID backfill
// Returns summaries only (counts, statuses), never user data.

export function secretOk(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  const secret = process.env.ADMIN_JOBS_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'ADMIN_JOBS_SECRET is not set in Vercel.' });
    return;
  }
  if (!secretOk(req.headers?.authorization, secret)) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  let body;
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {};
  } catch {
    res.status(400).json({ error: 'Body must be JSON.' });
    return;
  }
  try {
    const db = adminDb();
    if (body.action === 'mapr-run') {
      const now = Date.now();
      const ds = await loadStatsData(db);
      await ensureServerPlacePacks();
      const models = await runWeekly(db, { now, ds });
      const daily = await runDaily(db, { now, ds });
      res.status(200).json({ ok: true, daily, models });
      return;
    }
    if (body.action === 'refresh') {
      const ds = await loadStatsData(db);
      await ensureServerPlacePacks();
      const daily = await runDaily(db, { now: Date.now(), ds, slack: async () => ({ posted: false, skipped: true }) });
      res.status(200).json({ ok: true, daily });
      return;
    }
    if (body.action === 'backfill') {
      res.status(200).json(await backfillCreatedAt(db, await adminAuth()));
      return;
    }
    if (body.action === 'photo-backfill') {
      if (!process.env.GOOGLE_PLACES_API_KEY) {
        res.status(503).json({ error: 'GOOGLE_PLACES_API_KEY is not set in Vercel, so photos cannot be looked up.' });
        return;
      }
      await ensureServerPlacePacks();
      res.status(200).json(await runPhotoBackfill(db, ALL_LANDMARKS, { apiKey: process.env.GOOGLE_PLACES_API_KEY }));
      return;
    }
    res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes(SERVICE_ACCOUNT_MISSING)) {
      res.status(503).json({ error: 'FIREBASE_SERVICE_ACCOUNT is not set in Vercel.' });
      return;
    }
    console.error('admin-jobs failed:', msg);
    res.status(500).json({ error: `The job failed: ${msg}` });
  }
}
