# Landmark Hunters

A mobile-friendly trip planner for real landmarks in Miami, Milan/Monza, and Villanova/Main Line/Philadelphia — with GPS check-ins, a shared points leaderboard, and an AI trip-planning assistant. Also wrapped in [Capacitor](https://capacitorjs.com) as a real iOS app (see `ios/`).

## Run it locally

```bash
npm install
npm run dev
```

Trip planning (starting location, region, interests, landmark selection, itinerary) and browsing the explore map work immediately with no setup — trip state is stored in your browser's `localStorage`.

## Connect the backend (Firebase)

Accounts, check-ins, the leaderboard, friends, reviews, and landmark submissions are all shared across users, so they need a real backend. The app uses Firebase's free Spark tier (Auth + Firestore + Storage). Until you configure it, those features show a "not configured" message — trip planning and the explore map still work.

1. Create a free project at [console.firebase.google.com](https://console.firebase.google.com).
2. In **Build → Authentication → Sign-in method**, enable **Email/Password**. (Google sign-in isn't used — email/password only.)
3. In **Build → Firestore Database**, click **Create database** (start in production mode).
4. In **Build → Storage**, click **Get started** (needed for check-in/review/landmark photos).
5. In **Project settings → General**, scroll to "Your apps," add a **Web app**, and copy the config values.
6. Copy `.env.example` to `.env` and fill in the values:

   ```bash
   cp .env.example .env
   ```

7. Restart `npm run dev`.

### Firestore & Storage security rules

Deploy `firestore.rules` and `storage.rules` from this repo as-is (Firestore Database → Rules, and Storage → Rules) — they're the real, current rules the app depends on, not a snippet to hand-copy. Cover check-ins (immutable once claimed), the leaderboard, user profiles/usernames, friends and blocks, reviews (with report-based hiding), landmark submissions (with the same reporting, plus admin approval), and Storage photo uploads.

## AI features (optional)

The in-app AI assistant (the "✨ Ask AI" widget, the Mapr trip-planning chat, custom-interest matching on Setup, and landmark-submission verification) is powered by the Anthropic API via serverless functions in `api/`. Add `ANTHROPIC_API_KEY` to `.env` (see `.env.example`) to enable it locally, and as a Vercel environment variable in production. Without it, those features show a "not set up yet" message — everything else works fine.

## Google Maps Platform and other server secrets

Server routes read these from Vercel: `GOOGLE_PLACES_API_KEY` (Places API (New) only), `GOOGLE_ROUTES_API_KEY` (Routes API only), `ANTHROPIC_API_KEY`, `FIREBASE_SERVICE_ACCOUNT` and `CRON_SECRET`. The Google keys are separate on purpose, each restricted to its own API. Daily caps, the monthly budget and the current setup are written down in `docs/photos.md` (Owner setup).

## How the leaderboard resets

Each check-in increments per-period aggregate documents (`leaderboard_entries`) keyed by ISO week / calendar month / calendar year. When a new period starts, its key is new, so the leaderboard naturally shows zero for that period — no scheduled job required.

## Wrapping in Capacitor (iOS)

```bash
npm run ios:sync   # builds the web app and copies it into ios/App
npm run ios:open   # opens the Xcode project
```

From Xcode, pick a simulator or device and run. No CocoaPods needed — this uses Capacitor's Swift Package Manager integration.

## Tech

- React + Vite, mobile-responsive; screens are lazy-loaded (code-split) per route
- React Router (hash routing, so it works from a static file host or a Capacitor WebView)
- Firebase Auth (email/password, with email verification), Firestore (accounts, check-ins, leaderboard, friends, blocks, reviews, landmark submissions), and Storage (photos)
- Capacitor (`@capacitor/core`, `@capacitor/ios`) plus `@capacitor/geolocation` and `@capacitor/camera` for native location/camera access, with web fallbacks for the browser build
- Anthropic API (via Vercel serverless functions in `api/`) for the AI assistant, trip planning, and interest/landmark verification — rate-limited per endpoint
- Browser Geolocation API for the 30m check-in radius
- Trip/itinerary state in `localStorage`
- OpenStreetMap Nominatim for free geocoding of the starting location
