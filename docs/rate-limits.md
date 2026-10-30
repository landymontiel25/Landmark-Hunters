# Rate limits, daily quotas and App Check

Every `/api/*` route that costs money (Anthropic or Google) has three layers.
Plain Firestore writes from the app go through `firestore.rules`, not these.

## 1. Burst limit (`api/_lib/rateLimit.js`)

Per account (or per IP when signed out), in each warm serverless instance's
memory. Stops a script hammering one instance. Each route sets its own,
e.g. Mapr chat 10 per 10 minutes, address search 60 a minute (30 signed out).
Every user-facing route has one; the cron and admin routes are behind
`CRON_SECRET` / `ADMIN_JOBS_SECRET` instead.

## 2. Daily quotas (`api/_lib/usageQuota.js`)

Counters in Firestore `usage_quota`, shared by every instance, reset at
midnight Pacific (when Google's quotas reset).

- **Per caller**: each signed-in account gets a daily allowance per feature
  (`DAILY_QUOTAS[scope].user`); signed-out callers get a smaller one per IP
  (`anon`, Google routes only; AI routes need a sign-in).
- **Global breaker**: a cap across everyone (`global`), so abuse spread over
  many new accounts still stops. Override in Vercel without a deploy, e.g.
  `AI_DAILY_GLOBAL_CAP` (Mapr chat), `GOOGLE_AUTOCOMPLETE_DAILY_GLOBAL_CAP`.
  A hit logs a `usage_quota_global_cap` line in Vercel Logs.

| Scope | Route | Per account | Signed out (per IP) | Everyone |
|---|---|---|---|---|
| ai-plan | plan-ai (Mapr chat, trip planner) | 150 | none | 20,000 |
| ai-search | smart-search | 400 | none | 40,000 |
| ai-picks | pick-reasons | 200 | none | 20,000 |
| ai-classify | classify-interest | 100 | none | 10,000 |
| ai-verify | verify-landmark | 60 | none | 5,000 |
| ai-ratings | landmark-ratings | 1,500 | none | 60,000 |
| google-autocomplete | places-autocomplete | 600 | 150 | 20,000 |
| google-details | places-details | 300 | 60 | 10,000 |
| google-nearby | places-nearby | 150 | 30 | 5,000 |
| google-directions | directions | 200 | 40 | 8,000 |

If Firestore is down or `FIREBASE_SERVICE_ACCOUNT` is missing, quotas fail
open (the burst limit still applies) and log `usage_quota_error`.

## 3. App Check (`api/_lib/appCheck.js`, `src/lib/appCheck.js`)

Firebase App Check with reCAPTCHA Enterprise is the app's CAPTCHA: invisible,
scored per request, no puzzles. The web app attaches its token as
`X-Firebase-AppCheck`; the server checks it per `APP_CHECK_MODE`.

## Owner steps

1. **Hard spending caps first** (the backstop if every layer above fails):
   - Anthropic Console, Settings, Limits: set a monthly spend limit.
   - Google Cloud, Billing, Budgets & alerts: a budget with email alerts.
   - Google Cloud, APIs & Services, Quotas: keep the Places caps in
     `docs/photos.md` and add a daily cap on the Routes API (ComputeRoutes).
2. **TTL on old counters**: Firestore console, TTL policies, collection
   `usage_quota`, field `expireAt`.
3. **App Check on the web**:
   - Google Cloud: enable reCAPTCHA Enterprise, create a web key for your
     domains (the Vercel domain and any custom one).
   - Firebase console, App Check: register the web app with that key.
   - Vercel: `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=<key>`, `APP_CHECK_MODE=monitor`, redeploy.
   - Watch Vercel Logs for `app_check` lines for a few days. Web traffic
     should show none.
4. **Enforce**: only after the iOS app sends tokens (needs App Attest
   through `@capacitor-firebase/app-check`, not built yet). Until then
   `enforce` would block every iOS request. Then set `APP_CHECK_MODE=enforce`,
   and in Firebase App Check turn on enforcement for Firestore and Storage.
