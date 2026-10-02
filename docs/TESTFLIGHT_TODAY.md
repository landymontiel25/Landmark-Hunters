# Get Landmark Hunters onto TestFlight today

Oct 2, 2026. The owner's Apple Developer membership was just approved. This is
the shortest path from "approved" to "the app installed on my iPhone from
TestFlight". It skips everything that is only needed for the public App Store
(listing text, screenshots, privacy labels, Apple review). Those are in
`docs/IOS_APP_STORE_LAUNCH.md`, later.

Plan about 1.5 to 2 hours, most of it waiting for Apple to process the build.
**OWNER** = needs the owner in a browser, Xcode window or on the phone.
**MAC CLAUDE** = the Claude Code session on the owner's Mac can run it.

Nothing here edits push, Firebase config or APNs files in the repo. The only
repo change is the signing team Xcode writes into
`ios/App/App.xcodeproj/project.pbxproj` (optional to commit).

## Already true in the repo (checked)

- Bundle ID `com.landmarkhunters.app`. Version 1.0, build 1. iOS 15 minimum.
- App icon is a valid 1024 x 1024 PNG with no transparency. Launch screen exists.
- Signing is set to Automatic, but **no team is set yet** (step 3).
- Camera, photo library and both location usage strings are in `Info.plist`.
- Push entitlement is in `App.entitlements`; Xcode switches it to production
  automatically when archiving.
- The app already ran in the iOS simulator on the owner's Mac, so Xcode, Node and
  the SPM packages are probably installed. Skip any install step already done.

## Step 1. Check the Apple account (OWNER, 5 min)

1. https://developer.apple.com/account : "Membership details" must say
   **Active**. Copy the **Team ID** (10 characters).
2. https://appstoreconnect.apple.com : accept any agreement banner at the top
   ("Review Agreement"). Uploads fail until you do.
3. Still on App Store Connect: Users and Access: confirm your Apple ID is listed
   with role Account Holder or Admin. TestFlight internal testers must be users
   here, and you already are.

## Step 2. Create the app record (OWNER, 5 min)

App Store Connect > My Apps > **+** > New App.
- Platforms: iOS
- Name: Landmark Hunters (if "name already in use", use "Landmark Hunters: Travel"; the
  TestFlight name can change later)
- Primary language: English (U.S.)
- Bundle ID: choose `com.landmarkhunters.app`. If it is not in the dropdown yet,
  do step 3 first (Xcode registers it), then come back and refresh.
- SKU: `landmarkhunters-ios-1`
- User access: Full Access. Create.

## Step 3. Signing in Xcode (OWNER clicks, MAC CLAUDE preps, 10 min)

MAC CLAUDE:
```
cd <repo> && git checkout main && git pull origin main
npm ci
npm run ios:sync        # vite build + cap sync ios (builds the web app into the iOS project)
npm run ios:open        # opens Xcode
```
If `cap sync` complains about packages, open Xcode, wait for "Resolving Package
Dependencies" to finish at the bottom, then run `npm run ios:sync` again.

OWNER in Xcode:
1. Xcode > Settings > Accounts: the paid Apple ID must be listed. If not, **+** >
   Apple ID > sign in.
2. Left sidebar: click the blue **App** project > under TARGETS click **App** >
   tab **Signing & Capabilities**.
3. Tick **Automatically manage signing**. Team: pick the paid team (your name,
   "(Personal Team)" is the FREE one, do not pick that). Bundle Identifier stays
   `com.landmarkhunters.app`.
4. Wait for the red errors to disappear (10 to 60 seconds). You should see
   "Provisioning Profile: Xcode Managed Profile" and capabilities Push
   Notifications and Background Modes listed.
5. Red error "Communication with Apple failed" or "No account": agreement not
   accepted (step 1.2), or wrong Apple ID. "Failed to register bundle
   identifier": the ID is taken by another account; tell the web-session Claude
   to pick a new bundle ID (rare).

## Step 4. Firebase config file (OWNER, 3 min, skip if already in Xcode)

The repo does not contain `GoogleService-Info.plist`. In Xcode's file list under
App, check whether it is there. If yes, skip this step. If not:
1. Firebase console (project `landmark-hunters-284ab`) > project settings (gear) >
   Your apps. Add an iOS app with bundle ID `com.landmarkhunters.app` if none
   exists. Download `GoogleService-Info.plist`.
2. Drag it into the **App** folder in Xcode. Tick "Copy items if needed" and the
   **App** target. Do not commit it unless the owner decides to.

## Step 5. APNs key for push (OWNER, 5 min; needed only to test push)

You can install from TestFlight without this, but push will not arrive. Do it now
since you are in the portal.
1. developer.apple.com/account > Certificates, IDs & Profiles > **Keys** > **+**.
   Name: "Landmark Hunters APNs". Tick **Apple Push Notifications service
   (APNs)**. Continue > Register.
2. **Download the .p8 immediately. It can be downloaded only once.** Save it in a
   password manager. Write down the **Key ID** from the key's page.
3. Firebase console > project settings > **Cloud Messaging** tab > Apple app
   configuration > your iOS app > **APNs Authentication Key** > Upload. Choose
   the .p8, enter the Key ID and the Team ID (from step 1).

## Step 6. Archive and upload (MAC CLAUDE or OWNER, 15 min)

Make sure `npm run ios:sync` ran just before this (step 3), so the build contains
the newest web code. Build number 1 is fine for the first upload. For every later
upload raise `CURRENT_PROJECT_VERSION` by 1 (Xcode: App target > General > Build).

### Option A: Xcode window (easiest)
1. Top bar run destination: **Any iOS Device (arm64)**. (Not a simulator.)
2. Menu **Product > Archive**. Wait for the build (3 to 10 minutes). Organizer opens.
3. Select the new archive > **Distribute App** > **App Store Connect** > Next >
   **Upload** > Next. Keep "Automatically manage signing" > Next > Upload.
4. "Upload Successful" appears.

### Option B: command line (MAC CLAUDE), after steps 1 to 3 are done
Create `ios/ExportOptions.plist` (do not commit) with the real Team ID:
```
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>TEAMID_HERE</string>
  <key>signingStyle</key><string>automatic</string>
</dict></plist>
```
Then:
```
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath ../../build/App.xcarchive \
  -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath ../../build/App.xcarchive \
  -exportOptionsPlist ../ExportOptions.plist -exportPath ../../build/export \
  -allowProvisioningUpdates
```
The second command uploads because of `destination = upload`. It needs Xcode to be
signed in to the Apple ID (step 3.1).

### If the upload errors
| Message | Fix |
| --- | --- |
| "No signing certificate iOS Distribution" | Xcode > Settings > Accounts > select team > Manage Certificates > + > Apple Distribution. Retry. |
| "Invalid bundle / app record not found" | Step 2 not done, or bundle ID differs. |
| "The bundle version must be higher" / duplicate build | Raise the build number. |
| "Missing required icon" | Icon set is fine in the repo; confirm the target uses AppIcon (General > App Icons Source). |
| "SDK version" too old | Update Xcode from the Mac App Store. |

## Step 7. Wait for processing, answer the encryption question (OWNER, 10 to 30 min)

1. App Store Connect > the app > **TestFlight** tab. The build shows
   "Processing". Apple emails the owner if it fails; otherwise it flips to ready
   in 5 to 30 minutes (sometimes 1 hour).
2. A yellow **Missing Compliance** badge may appear. Click **Manage**. Answer: the
   app uses encryption: yes; it only uses standard encryption (HTTPS and what iOS
   provides) that is exempt. No export documents are needed. Save.
   (To skip this question on later builds, the web-session Claude can add
   `ITSAppUsesNonExemptEncryption = false` to `Info.plist` with the owner's yes.)

## Step 8. Install on the iPhone (OWNER, 5 min)

1. TestFlight tab > left side **Internal Testing** > **+** next to "Internal
   Testing" > create a group "Me" > add your Apple ID from the user list >
   enable the build for the group. Internal testing needs no Apple review.
2. On the iPhone install the **TestFlight** app from the App Store. Sign in with
   the same Apple ID. Accept the invite email, or open TestFlight and the app
   appears. Tap **Install**.
3. Open Landmark Hunters from the home screen.

## Step 9. First test pass (OWNER, 15 min)

Report anything broken to the web-session Claude as short bullets with a screenshot.
- Sign in (email + password, then Google), verify email works.
- Location: allow While Using, then Always when offered.
- Map opens, picks show, Test and Landmarks tabs load, a landmark photo appears.
- Rate 3 landmarks in Travel Picks: the streak should go up.
- Check in at a landmark; add a photo from camera and library.
- Push: with the .p8 uploaded (step 5), sign in on a second account, send the first
  a friend request, close the app on the phone. A notification should arrive.
- Mapr chat answers.

## What happens next time

1. Change code, merge to main. Vercel updates the server and website by itself.
2. Native app: MAC CLAUDE runs `git pull`, `npm run ios:sync`, raises the build
   number, archives and uploads (step 6). The new build appears in TestFlight and
   the phone offers an update. A web change reaches the iPhone only this way,
   because the web app is bundled inside the iOS app.

## Not needed for TestFlight, needed before the public App Store

Sign in with Apple (Apple usually requires it next to Google sign-in), updating
the privacy policy for "Always" location, a demo account, iPad decision,
screenshots and the listing, privacy labels. All in `docs/IOS_APP_STORE_LAUNCH.md`.
