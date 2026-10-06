# Landmark Hunters admin dashboard

The owner-only stats dashboard, as its own Next.js app and its own Vercel
project, apart from the app users see. The app has no admin stats page or
route any more.

## How it stays private

- **Password → session cookie.** `/login` checks `ADMIN_SECRET_TOKEN`
  (constant-time compare, 5 tries per 15 minutes per IP) and sets a signed
  session (`JWT_SECRET`) in an httpOnly, Secure, SameSite=Strict cookie that
  page scripts can't read. `proxy.ts` guards every `/dashboard` page and API.
- **Firestore stays locked.** The browser never talks to Firestore or holds
  a Firebase key. After login it asks `/api/firestore-read` (session
  required, fixed list of collections), and the server reads Firestore over
  REST with the service-account key (`FIRESTORE_ADMIN_KEY`, server only).
  App users and the app's public Firebase key can't reach the stats.
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
| Tools | Mapr run now (full job: models + Slack). The dashboard also runs a light refresh every 5 minutes while open. |

## Setup (once)

1. **Vercel project.** vercel.com/new → import `landymontiel25/Landmark-Hunters`
   → **Root Directory: `admin-dashboard`** → Framework: Next.js → Deploy.
2. **Environment variables** (Project Settings → Environment Variables, Production):
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

If the dashboard shows "Can't connect to Firestore", the message names the
cause: no key found (it lists the Firebase-related variable names the
deployment sees), a deleted or revoked key, or Google refusing the key. Fix
`FIRESTORE_ADMIN_KEY` for the environment you are viewing (Production or
Preview) and redeploy. No browser API key or Authorized-domains setting is
involved.

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
