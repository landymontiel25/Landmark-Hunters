# Landmark Hunters admin dashboard

The owner-only stats dashboard, as its own Next.js app and its own Vercel
project, apart from the app users see. The app has no admin stats page or
route any more.

## How it stays private

- **Password → session cookie.** `/login` checks `ADMIN_SECRET_TOKEN`
  (constant-time compare, 5 tries per 15 minutes per IP) and sets a signed
  session (`JWT_SECRET`) in an httpOnly, Secure, SameSite=Strict cookie that
  page scripts can't read. `proxy.ts` guards every `/dashboard` page and API.
- **Firestore stays locked.** After login the server mints a Firebase custom
  token for the uid `admin-dashboard` with the claim `dashboardAdmin: true`
  (only the Admin SDK, holding the service-account key, can mint it).
  `firestore.rules` `isDashboard()` lets only that identity read the stats
  collections. App users and the app's public Firebase key can't.
- **Admin jobs go server to server.** The Tools page calls this dashboard's
  `/api/jobs`, which calls the app's `api/admin-jobs.js` with
  `ADMIN_JOBS_SECRET`. The secret never reaches a browser.

## Live data

Every page uses Firestore `onSnapshot` listeners (`lib/listeners.ts`): no
polling, no refresh button. The app's nightly job (`api/mapr-nightly.js`,
00:23 UTC) writes the collections; Tools → "Mapr: run now" writes them on
demand. Listener health (subscribed, last update, reads, snapshot-to-screen
time, errors) shows on the Overview page and in the sidebar.

| Page | Collections |
|---|---|
| Overview | `mapr_metrics`, `growth_metrics`, `engagement_metrics` |
| Mapr Phase 1 | `mapr_metrics`, `mapr_ncf_model/current`, `mapr_similarity_matrix/current` |
| Growth | `growth_metrics` |
| Retention | `retention_cohorts` |
| Engagement | `engagement_metrics` |
| Accuracy | `accuracy_by_category`, `accuracy_by_city` |
| Taste | `taste_score`, `big_misses` (review status and notes are editable) |
| App metrics | `app_metrics/latest` (the old in-app admin stats and the long study) |
| Tools | Mapr run now, sign-up date backfill, photo backfill |

## Setup (once)

1. **Vercel project.** vercel.com/new → import `landymontiel25/Landmark-Hunters`
   → **Root Directory: `admin-dashboard`** → Framework: Next.js → Deploy.
2. **Environment variables** (Project Settings → Environment Variables, Production):
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID` = `landmark-hunters-284ab`
   - `NEXT_PUBLIC_FIREBASE_CONFIG` = the web config as one line of JSON
     (Firebase Console → Project settings → Your apps → Config), e.g.
     `{"apiKey":"…","authDomain":"landmark-hunters-284ab.firebaseapp.com","projectId":"landmark-hunters-284ab","appId":"…"}`
   - `ADMIN_SECRET_TOKEN` = your login password (`openssl rand -hex 16`)
   - `JWT_SECRET` = another random value, 32+ characters (`openssl rand -hex 32`)
   - `FIRESTORE_ADMIN_KEY` = the same service-account JSON as the app's
     `FIREBASE_SERVICE_ACCOUNT` (raw JSON or base64)
   - `APP_URL` = the app's address, e.g. `https://landmark-hunters.vercel.app`
   - `ADMIN_JOBS_SECRET` = a random value (`openssl rand -hex 32`)
3. **Main app project** (the existing Vercel project), add:
   - `ADMIN_JOBS_SECRET` = the same value as above
   - `DASHBOARD_URL` = this dashboard's address (adds a link to the Slack message)
4. **Publish the Firestore rules** from `firestore.rules` (Firebase Console →
   Firestore → Rules, or `firebase deploy --only firestore:rules`).
5. Redeploy both projects so they pick up the variables, open
   `https://<dashboard>/login`, sign in, and press Tools → "Mapr: run now"
   to fill every page.

If sign-in to Firestore fails with "requests from referer … are blocked", the
Firebase API key has website restrictions: add the dashboard's domain under
Google Cloud Console → APIs & Services → Credentials → that key.

## Develop and test

```bash
cd admin-dashboard
npm install
cp .env.example .env.local   # fill in
npm run dev
npm test                     # unit + route + listener + load tests (vitest)
npm run build && CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e   # Playwright
```

Phase 2 (not built): Firebase Auth sign-in instead of the shared password,
custom date ranges, annotations on charts.
