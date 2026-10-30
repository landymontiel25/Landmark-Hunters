# Security audit, 2026-10-30

The owner asked for a pass over a 20-point checklist. Rate limiting, quotas
and App Check shipped the same day in PR #760 (`docs/rate-limits.md`).

| # | Item | Result |
|---|---|---|
| 1 | Hide API keys | OK. Server keys (Anthropic, Google Places/Routes, service account, secrets) live only in `api/` via `process.env`. The browser gets only `VITE_*` values, which are public by design (Firebase web config, reCAPTCHA site key). |
| 2 | Env variables | OK. `.env*` and key files are git-ignored; `.env.example` holds no values. |
| 3 | Admin routes | OK. `admin-jobs`, `mapr-nightly` and `study-summary` need a bearer secret (constant-time compare) and answer 503 when it is unset. Admin screens check `isAdmin()`, and the rules require a verified email for it. Dashboard: httpOnly signed session, 16+ char password, constant-time compare, login attempt limit. |
| 4 | Authentication | OK. Firebase Auth; API routes verify the ID token server-side. |
| 5 | User access | Fixed 6 Firestore rule holes (below). |
| 6 | Sanitize forms | OK in general: rules cap sizes and key lists on most user writes. Several collections still lack key lists (open item). |
| 7 | XSS | OK. No `dangerouslySetInnerHTML`/`innerHTML`; React 19 blocks `javascript:` links; CSP has no `unsafe-inline` scripts. Escaped the one user-supplied value in map pin HTML (friend initials). |
| 8 | Rate limiting | Done in PR #760. |
| 9 | API endpoints | OK. Every user route checks sign-in and a rate limit, or (Google lookups) counts per IP when signed out. |
| 10 | CORS | OK. Only the native app origins get CORS headers; web is same-origin. Added the App Check header. |
| 11 | Security headers | OK (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy). Added COOP, and allowed reCAPTCHA in the CSP so App Check can load. |
| 12 | Debug mode | OK. No production source maps; the emulator switch needs `VITE_USE_EMULATOR`; `/test` redirects non-admins. |
| 13 | Dependencies | Updated within current major versions. App: 8 advisories to 0 (one `@grpc/grpc-js` override for the Firebase SDK). Dashboard: patched a critical Next.js advisory, now 0. Major upgrades left alone (firebase 13, @anthropic-ai/sdk 1.x). |
| 14 | Unused packages | None. Every dependency is imported, used by a script, or used by the iOS build. |
| 15 | Exposed files | OK. `public/` holds only images, place packs, `robots.txt` and the service worker. |
| 16 | Database | 6 rule fixes, 7 new emulator tests (all 164 pass). |
| 17 | Passwords | OK. Firebase Auth hashes them; the app never stores one. |
| 18 | Leaked secrets in git | **Owner action.** A Firebase service-account private key (id `8bc84a2c…`, `admin-dashboard/firebase-key.json`) was committed on 2026-10-06 and removed in c43b0cd. The repo is public, so anyone can still read it in history. Nothing else found. |
| 19 | Full audit | This document. |
| 20 | "Make no mistakes" | Tests, lint, build and rules emulator all pass. |

## Rule fixes (firestore.rules)

1. `landmark_ratings`: `avg` must equal `sum / count`. Before, any signed-in user could set any place's shown rating, which also fed Mapr's ranking.
2. Onboarding +10 needs a create-once `onboarding_payouts/{uid}` in the same write. Before, deleting and recreating your profile paid it again, without limit.
3. Group trip and Mapr project invites: no block in either direction, message of 500 characters or less, known fields only. Before, anyone could send any text to anyone through a trip they created.
4. Listing a friend's friends-only reviews now checks blocks.
5. Replies only on reviews you can see, with a capped name length.
6. Reporting a review needs to be able to see it.

Storage: review and check-in photo names now end in random digits, so friends-only photos can't be guessed from a uid and a timestamp.

## Owner steps

1. **Delete the leaked key now.** Google Cloud console, IAM & Admin, Service Accounts, the Firebase Admin SDK account, Keys: delete key `8bc84a2c…` if it is still listed. Deleting it makes the copy in git history useless. Rewriting history isn't enough on its own, since forks and caches keep copies.
2. Turn on GitHub secret scanning and push protection (repo Settings, Code security).
3. The steps in `docs/rate-limits.md` (spend limits, TTL, App Check).

## Open (not done in this pass)

- Two throwaway accounts can still hide a public review or a user-added place (two reports). Requiring a verified email for reports would block users who signed up with a password and never verified, so the owner should decide.
- `hasOnly` key lists and size caps are still missing on: `pick_feedback`, `planning_events`, `recommendation_log`, `feature_requests`, `bug_reports`, `usernames` update, streak `entries`, `users/{uid}`, and `group_trips` arrays.
- `custom_landmarks` allows `list` to anyone, including pending and hidden submissions with their submitter's uid.
- Group invites still don't require the people to be friends.
- iOS App Attest, before `APP_CHECK_MODE=enforce`.
