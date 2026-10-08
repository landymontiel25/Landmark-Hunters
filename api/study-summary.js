import { secretOk } from './_lib/secretOk.js';
import { adminDb, SERVICE_ACCOUNT_MISSING } from './_lib/firebaseAdmin.js';
import { buildSummary, studyDocument } from './_lib/statsSummary.js';
import { STUDY_COLLECTION } from '../src/lib/statsConstants.js';
import { FieldValue } from 'firebase-admin/firestore';

// Daily job (vercel.json "crons"). Vercel sends
// `Authorization: Bearer ${CRON_SECRET}` to cron invocations when the
// CRON_SECRET env var is set in the project; this route refuses everything
// else. With CRON_SECRET unset it answers 503 (never open to the world) and
// says so. It writes study_summaries/{YYYY-MM-DD, UTC} with Admin SDK only;
// firestore.rules denies every client read and write there. Totals only.
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'CRON_SECRET is not set in Vercel, so the daily summary cannot run.' });
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
    const date = new Date(now).toISOString().slice(0, 10);
    const summary = await buildSummary(db, now);
    // JSON round trip drops undefined, which Firestore refuses.
    const doc = JSON.parse(JSON.stringify(studyDocument(summary, date)));
    await db.collection(STUDY_COLLECTION).doc(date).set({ ...doc, createdAt: FieldValue.serverTimestamp() });
    res.status(200).json({ ok: true, date, users: summary.totals.users, truncated: summary.truncated });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes(SERVICE_ACCOUNT_MISSING)) {
      res.status(503).json({ error: 'FIREBASE_SERVICE_ACCOUNT is not set in Vercel, so the daily summary cannot run.' });
      return;
    }
    console.error('study-summary failed:', msg);
    res.status(500).json({ error: 'Could not write the daily summary.' });
  }
}
