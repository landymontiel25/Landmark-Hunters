# Landmark photos

About 463 of 1,244 catalog landmarks have `images: []`. Instead of storing photos for them, the app fetches one from Google Places at runtime and shows it with the credit Google requires. Landmarks that already have an image never trigger any of this.

## How it works

1. A landmark with no image (and no personal check-in photo) renders its colored category tile. Where it renders: `LandmarkThumb` (list rows, itinerary, map popups, trip/Mapr cards), `LandmarkPostcard` (the landmark page hero), `PickPhoto` (nearby picks), and `MaprPickImage` (Mapr picks and streak vote cards).
2. `src/lib/usePlacePhoto.js` waits until the tile is near the viewport (IntersectionObserver), then calls `src/lib/placePhoto.js`. That module dedupes per page session in memory, runs at most 3 requests at once, and backs off for 60 s after a 401/429/503. It never writes to localStorage, IndexedDB or Firestore.
3. `GET /api/place-photo?name=&lat=&lng=` (`api/place-photo.js`) requires sign-in, is limited to 90 requests per account per 10 min, then:
   - Looks up `place_ids/{region}__{landmarkId}` (see "Place-ID cache" below). If a verified place ID is stored, it skips Text Search and calls **Place Details** with field mask `photos` only to get a fresh photo reference.
   - Otherwise (no doc, obsolete ID, or an expired no-match) Places API (New) **Text Search** with a 250 m circular location bias, up to 5 results, field mask `places.id,places.displayName,places.location,places.photos`, and stores the resulting ID.
   - Accepts a result only if it has a photo, is within 250 m of the landmark, and its name matches strictly (`namesMatch`: same words, or one name wholly inside the other with enough overlap). A weak match returns `{url: null}` and the placeholder stays, so a wrong place's photo is never shown.
   - Calls the **Place Photos** media endpoint (`maxWidthPx=800&skipHttpRedirect=true`) for the first photo and returns `{url, attributions: [{name, uri}]}`. `url` is Google's short-lived `photoUri`.
   - `Cache-Control: public, max-age=0, s-maxage=10800, stale-while-revalidate=3600`: the Vercel edge may reuse the JSON for 3 h, browsers never.
4. The UI shows "Photo: <author> via Google Maps" (author links to their Google Maps profile). Tiny thumbnails show a small (c) badge instead of the full text, with the full credit in its title and link. If the image fails to load or anything errors, the tile stays.

Google Maps Platform compliance: the image bytes are never downloaded or re-hosted, and photo names/URLs are never persisted (no database, no landmark data, no localStorage). The one persisted Google value is the **place ID**, which Google's Place IDs page explicitly exempts from the caching restrictions ("You can therefore store place ID values for later"). Everything else is in-memory for the session (2 h cap) plus the 3 h CDN cache on the JSON. The attribution is displayed wherever the photo appears. Google's terms can change; re-read the Places "Policies" page if you extend this.

Note: because the endpoint requires an `Authorization` header, the Vercel edge may not cache these responses at all; the cache header is harmless either way, and in-memory client dedupe plus the per-account limit are the real controls.

## Place-ID cache

Firestore collection `place_ids/{region}__{landmarkId}`, read and written only by the Admin SDK in `api/place-photo.js` (needs `FIREBASE_SERVICE_ACCOUNT`). `firestore.rules` denies all client access (`allow read, write: if false`). It holds no user data, so account deletion is unaffected.

Doc: `{ placeId, matchedName, lat, lng, verifiedAt (server time), source: 'text-search', status: 'ok' | 'no-match' }`. Nothing else is ever written: no photo bytes, photo names, photoUris or attributions (a test asserts the exact field list).

The client sends `region` and `id` along with name/lat/lng. The server only trusts a stored doc if the request's name still matches `matchedName` and the coordinates are within 250 m of the stored ones (the query string is client-supplied). Requests without a safe region/id skip the cache and behave as before.

Flow: `ok` doc, Place Details (`photos` mask) returns the photo; Details 404/400 (obsolete ID), the doc is deleted, one Text Search runs and the new ID is stored; no doc, Text Search, store the ID (or a `no-match` doc), then the photo; `no-match` doc younger than its retry window, answer `{url: null}` with no Google call. If Admin credentials are missing, Firestore errors, or it takes over 3 s, the route logs a `place-photo: ...` console line and does exactly what it did before the cache. A cache failure never fails a photo. Transient Place Details errors (5xx/429) answer 502 and keep the stored ID.

Constants in `api/_lib/placeIdConstants.js`: `PLACE_ID_REFRESH_MS` = 365 days (Google recommends refreshing IDs older than 12 months; the free Place Details call re-verifies it and bumps `verifiedAt`), `PLACE_ID_NO_MATCH_RETRY_MS` = 30 days, `PLACE_ID_FIRESTORE_TIMEOUT_MS` = 3 s.

## What it costs (Google Maps Platform list prices, checked 2 Oct 2026; Google's page says last updated 2026-09-28)

Sources: [pricing list](https://developers.google.com/maps/billing-and-pricing/pricing), [Place Data Fields](https://developers.google.com/maps/documentation/places/web-service/data-fields), [Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id). Re-check before relying on them.

| Call | SKU | Per 1,000 calls | Free per month |
| --- | --- | --- | --- |
| Text Search with `displayName`, `location`, `photos` | Text Search Pro | $32.00 | 5,000 |
| Text Search, IDs only | Text Search Essentials (IDs Only) | free | unlimited |
| Place Details, field mask `photos` only | Place Details Essentials (IDs Only) | free | unlimited |
| Place Details, `displayName` | Place Details Pro | $17.00 | 5,000 |
| Photo media request (`.../media`) | Place Details Photos | $7.00 | 1,000 |

The key fact: in Google's field table the `photos` field is **Text Search Pro** when requested from Text Search, but **Place Details Essentials (IDs Only)**, which is unlimited and free, when requested from Place Details. Google's Place IDs page also says a stored ID can be refreshed "at no charge" with a Place Details request for the ID field only. So with a stored ID the only billed call is the photo media request.

Per photo view (all prices are the first-tier list price, before free allowances):

| | Before (no cache) | After, ID cached | After, first view of a landmark |
| --- | --- | --- | --- |
| Lookup | Text Search Pro $0.032 | Place Details (IDs Only) $0 | Text Search Pro $0.032, once |
| Photo media | $0.007 | $0.007 | $0.007 |
| Total | $0.039 | $0.007 | $0.039, once ever |

So a repeat view costs about 18% of before, a saving of roughly 82% (the owner's "about a fifth" was right). It is not 35-40%: the photo reference does have to be fetched fresh each time, but that fetch (Place Details with `photos` only) is the free tier, not a billed Details call. The photo media request ($7 per 1,000, free allowance 1,000/month) stays the permanent per-view cost; only the 3 h edge cache and the client's in-session dedupe reduce it. A landmark Google cannot match used to cost $0.032 on every view; now it costs $0.032 once per 30 days.

Seeding all 463 photo-less landmarks once is roughly $15 in Text Search Pro before the free 5,000/month, which covers it entirely.

Unconfirmed: the SKU details page (`/billing-and-pricing/sku-details`) could not be machine-read, so the IDs Only classification of Place Details + `photos` rests on the field table and the Place IDs page above. Confirm with the first month's billing report (look for "Place Details Essentials (IDs Only)" on Place Details calls and no "Place Details Pro/Enterprise" lines). If Google bills Details with `photos` at a paid tier, each view would cost $0.017-0.020 + $0.007, about 40-50% cheaper than before rather than 82%.

## Admin photo backfill (one-time)

Admin dashboard, Tools page, "Landmark photos (one batch)", button **Run** (`POST /api/admin-jobs {action: 'photo-backfill'}` via the dashboard's server, code in `api/_lib/photoBackfill.js`).

- For every landmark with no stored photo it runs the same strict Text Search match as `api/place-photo.js` (shared code in `api/_lib/placeLookup.js`) and saves the result to `place_ids`: a place ID, or a "no match" marker (kept 30 days). It saves **place IDs only**. It never fetches or stores an image, photo name or photo link, and makes no Place Details calls.
- One batch (20 landmarks) per call. The page repeats the call every 2.5 minutes while the tab is open (8 searches a minute, under the 90 per 10 minutes limit), shows progress (checked, Google has a photo, no match, failed this run, searches today) and has a Stop button.
- At most 300 backfill searches per day, counted per Pacific-time day in `place_backfill_usage/{date}` (Google's quota is 400 and resets at midnight Pacific; the other 100 are for live views). When it reaches 300 the run stops and says to come back tomorrow.
- A failed search (Google error, timeout) is not saved, so the next press retries it. A Google 429 or 403, or 3 failures in a row, stops the run. Each failure writes one `place-photo: ... (backfill: ...)` line to the Vercel logs with the step and Google status (never the key).
- Safe to run again at any time: landmarks that already have a saved result are skipped.
- All numbers are in `src/lib/statsConstants.js` (`PHOTO_BACKFILL_*`).
- Rules: `place_backfill_usage` is server-only, like `place_ids` (`allow read, write: if false`), with an emulator test. It holds no user data, so account deletion has nothing to remove.
- Once place IDs are saved, each tile view makes one free Place Details lookup (the IDs-only photo reference). If you set a daily quota on `GetPlaceRequest`, keep it comfortably above expected views.

## Capping spend

- Google Cloud console, APIs & Services, Places API (New), Quotas: set a low **Requests per day** on Text Search (and on the Photos method). Once the cap is hit Google returns errors, the route answers 502, and the app keeps showing the placeholder tile.
- Billing, Budgets & alerts: add a budget with alert thresholds on the project.
- The per-account limit lives in `api/place-photo.js` (`limit: 90, windowMs: 10 min`). The client concurrency limit is `MAX_CONCURRENT` in `src/lib/placePhoto.js`.
- Kill switch: remove `GOOGLE_PLACES_API_KEY`, or remove the Places API (New) from the key's API restrictions; the route then fails and every tile stays a placeholder.

## Owner setup

State as of Oct 2 (recorded from the owner; no code depends on it):

- **Places API (New)** is enabled in the Google Cloud project "Landmark Hunters" (`landmark-hunters-284ab`), with billing enabled.
- **Two separate API keys.**
  - "Places key" (created Oct 2): allows Places API (New) only. It is the value of `GOOGLE_PLACES_API_KEY` in Vercel for Production and Preview.
  - "Routes key" (created Sep 25): allows Routes API only. It is `GOOGLE_ROUTES_API_KEY` (used by `api/directions.js`).
  - Server-side use means neither key has an HTTP-referrer restriction.
- **Daily Places API (New) caps** (Cloud console, APIs & Services, Quotas): SearchTextRequest 100, GetPlaceRequest 300, GetPhotoMediaRequest 1000, AutocompletePlacesRequest 500, SearchNearbyRequest 100. **If photos or search stop working, check these first.** Once a cap is hit Google returns errors and the route answers 502 (the failing step and Google status now show in Vercel Logs as `place-photo:` lines).
- **Budget:** $20 a month with email alerts at 50%, 90% and 100%.
- Other Vercel secrets: `ANTHROPIC_API_KEY` was rotated and the old key deleted. `CRON_SECRET` and `FIREBASE_SERVICE_ACCOUNT` are set in Production. The iOS app was rebuilt and tested in the simulator.
- Deploy; `api/place-photo.js` has `maxDuration: 30` in `vercel.json`.

## Why not Unsplash, Pexels or stock subscriptions

These cover generic scenery, not specific local businesses. Searching for "Joe's Pizza on Main St" returns unrelated pizza photos, which is worse than a placeholder (it is the wrong place, and misleading). Their licenses also typically forbid implying the pictured place is that business, and attribution/hotlinking rules vary by site. Stock subscriptions cost money per seat or per download and still would not have pictures of a small local cafe. Google Places is the one source that has photos tied to the specific place.

## Alternative: curated Wikimedia Commons images for famous landmarks

For well-known landmarks (a museum, monument, park) Wikimedia Commons has real photos under free licenses (CC BY, CC BY-SA, public domain) and costs nothing per view. Many catalog entries already use `commons.wikimedia.org/wiki/Special:FilePath/...`. To add more:

1. Find the file for the landmark on Commons (via the Wikipedia/Wikidata `image` property).
2. Check its license on the file page: CC0/public domain need no credit; CC BY needs author, license name and link; CC BY-SA needs the same plus the license link, and adaptations (crops are generally fine) must carry the same license.
3. Store the image URL plus `credit` (author, license, source link) in the landmark data, and show that credit near the photo, the same way `PlacePhotoCredit` does for Google.
4. This is a one-time curation (or script using the Commons API `imageinfo` / `extmetadata`), has no runtime cost, and is permitted to be stored, unlike Google photos. It only works for places famous enough to have good Commons coverage; use Google as the fallback for the rest.
