# iOS launch guide: from Apple Developer approval to the App Store

Written Oct 2, 2026 for the owner and the Claude Code session on the owner's Mac.
The owner was just accepted into the Apple Developer Program (paid, $99/year).
This file is the single plan. Read all of it before starting. Do the steps in
order. Items marked **OWNER** need a person signed in to an Apple or Firebase
website or a phone in hand; Claude on the Mac can run the shell and Xcode
command-line parts and edit files, but cannot click through Apple's websites.

Related: `docs/LAUNCH_BACKGROUND_PLAN.md` (the background location and push
design). `CLAUDE.md` (repo workflow, `APP_HELP` rule). Do not edit push,
Firebase config or APNs files unless the owner says so in that session.

## 0. Facts about this app (verified in the repo)

| Item | Value |
| --- | --- |
| App name | Landmark Hunters |
| Bundle ID | `com.landmarkhunters.app` (`capacitor.config.json`, Xcode project) |
| Version / build | `MARKETING_VERSION = 1.0`, `CURRENT_PROJECT_VERSION = 1` |
| Minimum iOS | 15.0 |
| Devices | iPhone and iPad (`TARGETED_DEVICE_FAMILY = "1,2"`) |
| Capacitor | 8.x. Plugins: camera, geolocation, `@capacitor-community/background-geolocation`, `@capacitor-firebase/messaging` |
| Package manager for iOS | Swift Package Manager (`ios/App/CapApp-SPM`), not CocoaPods |
| Web build folder | `dist` (`vite build`), synced into the iOS project |
| Push entitlement | `aps-environment = development` in `ios/App/App/App.entitlements` |
| Background modes | `location` and `remote-notification` (`Info.plist`) |
| Location strings | `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`, camera, photo library, photo library add |
| Sign-in | Email + password (with email verification) and Google (`signInWithPopup`). No Sign in with Apple yet. |
| Account deletion | Exists in Settings (tested). Required by Apple. |
| Privacy policy / terms | In-app screen `src/screens/Legal.jsx`, route `/legal`, public (no sign-in). URL: `https://landmarkhunters.com/#/legal`. Contact: `supportlandmarkhunters@gmail.com` |
| Firebase iOS config | `GoogleService-Info.plist` is NOT in the repo. It must come from the Firebase console and be added in Xcode (see step 2). |
| Backend | Vercel (landmarkhunters.com), Firebase project `landmark-hunters-284ab` |
| Web shell | The native app loads the built web app from `dist` (not a remote URL), so a web change reaches the phone only after a new `npm run ios:sync` and a new build |

The in-app web app and the iOS app share one codebase. The iOS app calls the
Vercel `/api/*` functions through `API_BASE`, so server fixes apply to both.

## 1. Confirm the Apple account (OWNER, 5 minutes)

1. Sign in at https://developer.apple.com/account. "Membership details" must
   show **Active**. If it says "Enrollment pending", wait; nothing below works.
2. Note the **Team ID** (10 characters, Membership details). It is needed for
   the APNs key and Firebase.
3. https://appstoreconnect.apple.com: accept any banner agreements ("Apple
   Developer Program License Agreement" and, if asked, others). Until accepted,
   uploads and app creation fail with confusing errors.
4. Individual vs organization: an individual account shows the owner's legal
   name as the seller on the App Store. An organization needs a D-U-N-S number.
   Decide now; changing later is painful.

## 2. Prepare the Mac and run the app on a real iPhone (OWNER + Mac Claude)

Needed: a Mac with the current Xcode from the Mac App Store (Apple only
accepts uploads built with a recent Xcode; if the upload is refused for the SDK
version, update Xcode), Node 20+ (`node -v`), the repo cloned,
an iPhone and a cable.

Mac Claude runs:

```
git checkout main && git pull origin main
npm ci
npm run ios:sync        # vite build + cap sync ios
npm run ios:open        # opens Xcode
```

If `cap sync` errors about SPM packages, open Xcode once, wait for "Resolving
Package Dependencies" to finish, then rerun. `Package.resolved` under
`ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/` gets rewritten
by Xcode; do not commit it unless asked (it was kept out of the photo PR on
purpose).

In Xcode (OWNER clicks):

1. Xcode > Settings > Accounts > + > sign in with the Apple ID that owns the
   developer membership.
2. Select the **App** project > **App** target > **Signing & Capabilities**.
3. Tick **Automatically manage signing**, set **Team** to the paid team. Leave
   the bundle ID as `com.landmarkhunters.app`. Xcode registers the ID and makes
   the provisioning profile. Red errors here are almost always a wrong team or an
   unaccepted agreement (step 1.3).
4. Confirm the capabilities **Push Notifications** and **Background Modes**
   (Remote notifications; Location updates is the contested one, see 8.4) are
   present. They are already in `App.entitlements` and `Info.plist`.
5. **Firebase config file (OWNER).** Firebase console > project settings >
   Your apps. If there is no iOS app, add one with bundle ID
   `com.landmarkhunters.app`. Download `GoogleService-Info.plist` and drag it into
   the **App** folder in Xcode with "Copy items if needed" and the App target
   ticked. Do not commit this file unless the owner says the repo already
   handles it. Without it, Firebase push and any native Firebase use fail at
   launch.
6. On the iPhone: Settings > Privacy & Security > Developer Mode > on (restarts
   the phone). Plug in, choose the phone as the run destination, press Run.
   First run: iPhone Settings > General > VPN & Device Management > trust the
   developer profile if asked.
7. Quick sanity pass on the device: the app opens to the map, sign in works,
   the location prompt appears, the Test tab loads. Fix anything before moving on.

## 3. Push notifications: APNs key into Firebase (OWNER)

Without this, push never arrives on a real phone, even though the code is in place.

1. https://developer.apple.com/account > Certificates, IDs & Profiles > **Keys** > +.
   Name it "Landmark Hunters APNs". Tick **Apple Push Notifications service
   (APNs)**. Continue, Register.
2. **Download the `.p8` file now. Apple lets you download it exactly once.** Store
   it somewhere private (password manager). Write down the **Key ID** (shown on
   the key page) and the **Team ID** (step 1.2).
3. Firebase console > project settings > **Cloud Messaging** > under "Apple app
   configuration" choose the iOS app > **APNs Authentication Key** > Upload.
   Enter the `.p8`, Key ID and Team ID.
4. Server side: the app sends push through Firebase Cloud Messaging from the
   Vercel functions (`api/_lib/firebaseAdmin.js`, `api/_lib/push.js`) using
   `FIREBASE_SERVICE_ACCOUNT`, which is already set in Vercel Production. Nothing
   to change there.

The entitlement `aps-environment` is `development` in the repo. For Archive and
TestFlight, Xcode signs with a distribution profile that switches it to
`production` automatically. If push works when running from Xcode but not from
TestFlight, check this first: open the archived `.app`'s entitlements
(`codesign -d --entitlements - App.app`) and confirm `production`.

## 4. Create the app record in App Store Connect (OWNER)

My Apps > + > New App.

- Platforms: iOS. Name: "Landmark Hunters" (must be unique on the whole App
  Store; if taken, add a subtitle-style suffix). Primary language: English (US).
- Bundle ID: pick `com.landmarkhunters.app` from the list (it appears after step
  2.3 registered it; if missing, create it at developer.apple.com > Identifiers).
- SKU: any private string, for example `landmarkhunters-ios-1`.
- User access: Full Access.

## 5. Archive and upload the first build (Mac Claude + OWNER)

1. Mac Claude: `npm run ios:sync` again so the build contains the latest web code.
2. Xcode: run destination **Any iOS Device (arm64)**. Product > **Archive**.
3. In Organizer: select the archive > **Distribute App** > **App Store Connect** >
   Upload > automatic signing > Upload.
4. Raise `CURRENT_PROJECT_VERSION` (build number) for every upload; the marketing
   version (1.0) can stay. A duplicate build number is rejected.
5. Export compliance: the app uses only standard HTTPS encryption. Adding
   `ITSAppUsesNonExemptEncryption = false` to `Info.plist` removes the question on
   every upload (needs owner approval; it is a native config change).
6. Wait 5 to 30 minutes. The build appears in App Store Connect > TestFlight with
   "Processing". An email arrives if it is rejected for a technical reason (most
   often a missing icon size, a missing usage-description string, or the
   privacy manifest).

## 6. TestFlight on the real phone (OWNER)

1. App Store Connect > TestFlight > Internal Testing > create a group, add the
   owner's Apple ID (it must be an App Store Connect user). No Apple review is
   needed for internal testers.
2. Install **TestFlight** on the iPhone, accept the invite, install the build.
3. Real-world checklist (the simulator cannot do these):
   - Create a new account, verify email, finish onboarding, rate 10 places.
   - Allow location "While Using", then the upgrade to "Always" flow.
   - Check in at a real place (GPS check-in is currently not enforced:
     `REQUIRE_GPS_CHECKIN=false` in `src/lib/checkinRules.js`).
   - Receive a push notification while the app is closed (a friend request from a
     second account is the easiest trigger).
   - Take a check-in photo; add a photo from the library.
   - Mapr chat, Travel Picks, daily streak (rate 3 landmarks), directions.
   - Settings > delete account on a throwaway account.
   - Rotate to landscape and open on an iPad if iPad stays enabled (8.5).
4. Send findings to the web-session Claude as short bullet points with
   screenshots; it fixes server and web code, the Mac session re-syncs and
   re-uploads.

## 7. App Store listing (OWNER, Claude can draft all text)

App Store Connect > the app > the version page. Required:

- **Screenshots**: 6.9-inch iPhone (1320 x 2868) is required; 6.5-inch is accepted
  as the fallback size. If iPad is enabled you also need 13-inch iPad screenshots
  (see 8.5). Take them in TestFlight or the simulator.
- **Description, promotional text, keywords (100 characters), support URL,
  marketing URL** (optional). Support URL can be `https://landmarkhunters.com`.
- **Privacy Policy URL**: `https://landmarkhunters.com/#/legal` (public).
- **Category**: Travel (primary), Lifestyle or Social Networking (secondary).
- **Age rating questionnaire**: the app has user-generated content (comments,
  reviews, photos, friends) and an AI assistant; answer honestly. Expect 12+ or
  17+ depending on the UGC and unrestricted web access answers.
- **App Privacy ("nutrition labels")**: see 8.2.
- **App Review information**: contact name, phone, email, a **demo account**
  (see 8.6) and notes (see 8.7).
- **Copyright**, **Content rights**, and the price (free).

## 8. App-specific review risks (read before submitting)

### 8.1 Guideline 4.8: Sign in with Apple
The app offers Google sign-in. Apple requires an equivalent privacy-preserving
login option (usually Sign in with Apple) in an app that offers a third-party
social login. Email and password sign-up exists, but reviewers commonly still
ask for it. Recommended: add Sign in with Apple. Work involved: Xcode capability
"Sign in with Apple", an Apple "Services ID" and key (developer.apple.com),
Firebase console > Authentication > Sign-in method > Apple, and a button in
`src/lib/AuthContext.jsx` plus a Capacitor plugin or Firebase's native flow.
Decide before the first submission; it cannot be added after rejection without
another review cycle.

### 8.2 Privacy policy must match what the app does (needs a fix)
`src/screens/Legal.jsx` currently says location "is only read while you're using
the app". The app asks for "Always" and includes a background-geolocation plugin,
so that sentence is wrong once background features ship. Apple compares the
policy, the App Privacy labels and the permission strings. Update the policy text
(web change, the web-session Claude does it) to describe Always location, the
on-device habit learning, and push tokens, before submitting.
App Privacy answers to start from:
- Contact info: email address, name (account; linked to the user; app functionality).
- Location: precise location (app functionality; linked; not used for tracking).
- Photos or videos: photos the user attaches (linked; app functionality).
- User content: reviews, comments, ratings, landmark submissions, AI chat messages.
- Identifiers: user ID and device push token (app functionality).
- Usage data: product interaction (stats, streaks, leaderboard).
- Third parties that receive data: Firebase (Google), Anthropic (AI chat), Vercel
  (hosting), Google Maps Platform (place lookups). Declare "Data used to track
  you": No (there is no advertising).

### 8.3 Always location wording
`NSLocationAlwaysAndWhenInUseUsageDescription` says Mapr keeps learning "even
while the app is closed". Apple rejects vague or overreaching reasons. Keep it
specific: what the user gets (a "rate this place you left" prompt, a heads-up
near a habit place), and that the routine stays on the phone. The review notes
must show how to trigger the feature (turn on habit tracking in Settings, visit a
place). Do not ask for Always on first launch; only after the user understands the benefit.

### 8.4 The `location` background mode
`Info.plist` lists `UIBackgroundModes: location`. Region and visit monitoring do
not need it. Keeping it invites "why does the app track continuously" questions
and can lead to rejection if the app does not truly track continuously. Either
remove it (recommended; `docs/LAUNCH_BACKGROUND_PLAN.md` says so) or be ready to
justify it. Needs owner approval; a native config change.

### 8.5 iPad
`TARGETED_DEVICE_FAMILY = "1,2"` means iPad is supported, so iPad screenshots are
required and the app must be usable at iPad sizes (the layout is a phone-width
column). Either set the target to iPhone only (`1`) or test and shoot iPad
screenshots. iPhone-only is faster for a first release.

### 8.6 Demo account for the reviewer
The reviewer cannot receive a verification email. Create a **non-admin account
with a verified email** and enough ratings (10 or more) that Mapr picks show.
Give its email and password in App Review information. Do not give an admin
account (admin has the Test tab and stats page).

### 8.7 Review notes (paste and adjust)
"Landmark Hunters is a travel and landmark discovery app. Sign in with the demo
account provided. The Map tab shows picks near the user; if the reviewer is not
at a landmark, use the Landmarks tab to search a city and rate places. Location
'Always' is optional and only used for 'rate the place you just left' and habit
suggestions; enable it in Settings > habit tracking. Account deletion is in
Settings. Reports and blocking are in the friends panel and landmark pages. The
AI assistant (Mapr) is powered by a third-party model; no content is generated
for sale or advertising."

### 8.8 User-generated content (guideline 1.2)
The app has comments, reviews, photos and friends. Apple requires: a way to
report offensive content, a way to block abusive users, a published way to
contact the developer, and terms that forbid objectionable content. Blocking
exists (`FriendsPanel.jsx`, Settings); verify a **report** action exists on
reviews/comments/photos and that `Legal.jsx` terms prohibit objectionable content.
Add what is missing before submitting.

### 8.9 Account deletion
Already in Settings and covered by a test (5.1.1(v)). Mention the path in the
review notes.

### 8.10 Other checks
- The app name, icon and screenshots must not use Google Maps, Wikimedia or
  other third-party marks in a misleading way. Stored Wikimedia photos show
  author and license credits; keep them.
- Google Maps Platform photos show their required attribution already.
- Subscriptions or purchases: none. If any are added later, StoreKit and a Paid
  Applications agreement are needed.
- A privacy manifest (`PrivacyInfo.xcprivacy`) is required for apps and for
  third-party SDKs that use "required reason" APIs (UserDefaults, file
  timestamps, etc.). The Firebase and Capacitor packages ship their own. If
  App Store Connect emails "ITMS-91053 missing API declaration", add the app's
  own `PrivacyInfo.xcprivacy` with the declared reasons it names.

## 9. Submit

1. Version page > select the processed build > fill every required field.
2. **Add for Review** > Submit. First review takes about 1 to 3 days. A rejection
   comes with a guideline number and a message; reply in Resolution Center or fix
   and upload a new build.
3. Choose **manual release** the first time so you control the launch date.

## 10. After launch

- Web changes reach iPhone users only through a new build (the web app is bundled
  in the app). Server changes (Vercel) apply immediately to everyone.
- Raise the build number for each upload. Use TestFlight for every update first.
- Keep `APP_HELP` (`api/_lib/appHelp.js`) in sync with any user-facing change
  (repo rule).
- Google Cloud: keep the daily caps and the $20 budget from `docs/photos.md`.
  After the one-time photo backfill finishes, raise `GetPlaceRequest` per day
  from 300 to about 1000 so live tile views are not throttled.

## 11. Common problems

| Symptom | Likely cause and fix |
| --- | --- |
| "No account for team" / red signing errors | Wrong team picked, or agreement not accepted (step 1.3) |
| App crashes at launch, log mentions Firebase | `GoogleService-Info.plist` missing from the App target (step 2.5) |
| Push works from Xcode, not TestFlight | APNs key not uploaded to Firebase, or entitlement not `production` (step 3) |
| Upload rejected: invalid icon / missing string | Check `ios/App/App/Assets.xcassets` icon set (1024 px, no alpha) and the `Info.plist` usage descriptions |
| Build stuck "Processing" over an hour | Check the email from Apple for a rejection; otherwise wait or re-upload with a higher build number |
| `cap sync` SPM error | Open Xcode once so packages resolve, then rerun |
| Duplicate build number | Increase `CURRENT_PROJECT_VERSION` |
| Location prompt never shows Always | iOS only offers the upgrade after a while / second request; test on a real phone, not the simulator |

## 12. Decisions the owner needs to make (ask in this order)

1. Individual or organization seller name (step 1.4).
2. Add Sign in with Apple before the first submission? (8.1, recommended yes)
3. Remove the `location` background mode? (8.4, recommended yes)
4. iPhone only, or ship iPad too? (8.5, recommended iPhone only for v1)
5. Add `ITSAppUsesNonExemptEncryption = false`? (5.5, recommended yes)
6. Update the privacy policy text for Always location (8.2, needed).

Claude in the web session can do items 2 to 6 (code and text) once approved, then
the Mac session syncs and uploads a new build.
