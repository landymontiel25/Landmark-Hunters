# Landmark photos

About 463 of 1,244 catalog landmarks have `images: []`. Instead of storing photos for them, the app fetches one from Google Places at runtime and shows it with the credit Google requires. Landmarks that already have an image never trigger any of this.

## How it works

1. A landmark with no image (and no personal check-in photo) renders its colored category tile. Where it renders: `LandmarkThumb` (list rows, itinerary, map popups, trip/Mapr cards), `LandmarkPostcard` (the landmark page hero), `PickPhoto` (nearby picks), and `MaprPickImage` (Mapr picks and streak vote cards).
2. `src/lib/usePlacePhoto.js` waits until the tile is near the viewport (IntersectionObserver), then calls `src/lib/placePhoto.js`. That module dedupes per page session in memory, runs at most 3 requests at once, and backs off for 60 s after a 401/429/503. It never writes to localStorage, IndexedDB or Firestore.
3. `GET /api/place-photo?name=&lat=&lng=` (`api/place-photo.js`) requires sign-in, is limited to 90 requests per account per 10 min, then:
   - Places API (New) **Text Search** with a 250 m circular location bias, up to 5 results, field mask `places.displayName,places.location,places.photos`.
   - Accepts a result only if it has a photo, is within 250 m of the landmark, and its name matches strictly (`namesMatch`: same words, or one name wholly inside the other with enough overlap). A weak match returns `{url: null}` and the placeholder stays, so a wrong place's photo is never shown.
   - Calls the **Place Photos** media endpoint (`maxWidthPx=800&skipHttpRedirect=true`) for the first photo and returns `{url, attributions: [{name, uri}]}`. `url` is Google's short-lived `photoUri`.
   - `Cache-Control: public, max-age=0, s-maxage=10800, stale-while-revalidate=3600`: the Vercel edge may reuse the JSON for 3 h, browsers never.
4. The UI shows "Photo: <author> via Google Maps" (author links to their Google Maps profile). Tiny thumbnails show a small (c) badge instead of the full text, with the full credit in its title and link. If the image fails to load or anything errors, the tile stays.

Google Maps Platform compliance: the image bytes are never downloaded or re-hosted, and neither place IDs nor photo names/URLs are persisted (no database, no landmark data, no localStorage). The only retention is in-memory for the session (2 h cap) and the 3 h CDN cache on the JSON. The attribution is displayed wherever the photo appears. Google's terms can change; re-read the Places "Policies" page if you extend this.

Note: because the endpoint requires an `Authorization` header, the Vercel edge may not cache these responses at all; the cache header is harmless either way, and in-memory client dedupe plus the per-account limit are the real controls.

## What it costs (Google Maps Platform list prices, checked 1 Oct 2026)

Check the [pricing page](https://developers.google.com/maps/billing-and-pricing/pricing) before relying on these numbers.

| Call | SKU | Per 1,000 calls | Free per month |
| --- | --- | --- | --- |
| Text Search with `displayName`, `location`, `photos` | Text Search Pro | $32.00 | 5,000 |
| Photo media request (`.../media`) | Place Details Photos | $7.00 | 1,000 |

There is no cheaper Text Search tier that returns photos (IDs-only Text Search is $5 per 1,000 but has no photos). So one successful photo costs about $0.039; a lookup that finds no confident match costs $0.032. Seeding all 463 photo-less landmarks once is roughly $15-18 before the free tier, and less after it. Real spend depends on how many distinct photo-less landmarks users scroll past, because results are shared within a session and at the CDN but not saved between sessions.

## Capping spend

- Google Cloud console, APIs & Services, Places API (New), Quotas: set a low **Requests per day** on Text Search (and on the Photos method). Once the cap is hit Google returns errors, the route answers 502, and the app keeps showing the placeholder tile.
- Billing, Budgets & alerts: add a budget with alert thresholds on the project.
- The per-account limit lives in `api/place-photo.js` (`limit: 90, windowMs: 10 min`). The client concurrency limit is `MAX_CONCURRENT` in `src/lib/placePhoto.js`.
- Kill switch: remove `GOOGLE_PLACES_API_KEY`, or remove the Places API (New) from the key's API restrictions; the route then fails and every tile stays a placeholder.

## Owner setup

- **Places API (New)** enabled on the Google Cloud project that owns `GOOGLE_PLACES_API_KEY` (already used by autocomplete/details/nearby), with **billing enabled**.
- If the key has API restrictions, Places API (New) must be allowed. Server-side use means the key should have no HTTP-referrer restriction.
- Deploy; `api/place-photo.js` has `maxDuration: 30` in `vercel.json`.

## Why not Unsplash, Pexels or stock subscriptions

These cover generic scenery, not specific local businesses. Searching for "Joe's Pizza on Main St" returns unrelated pizza photos, which is worse than a placeholder (it is the wrong place, and misleading). Their licenses also typically forbid implying the pictured place is that business, and attribution/hotlinking rules vary by site. Stock subscriptions cost money per seat or per download and still would not have pictures of a small local cafe. Google Places is the one source that has photos tied to the specific place.

## Alternative: curated Wikimedia Commons images for famous landmarks

For well-known landmarks (a museum, monument, park) Wikimedia Commons has real photos under free licenses (CC BY, CC BY-SA, public domain) and costs nothing per view. Many catalog entries already use `commons.wikimedia.org/wiki/Special:FilePath/...`. To add more:

1. Find the file for the landmark on Commons (via the Wikipedia/Wikidata `image` property).
2. Check its license on the file page: CC0/public domain need no credit; CC BY needs author, license name and link; CC BY-SA needs the same plus the license link, and adaptations (crops are generally fine) must carry the same license.
3. Store the image URL plus `credit` (author, license, source link) in the landmark data, and show that credit near the photo, the same way `PlacePhotoCredit` does for Google.
4. This is a one-time curation (or script using the Commons API `imageinfo` / `extmetadata`), has no runtime cost, and is permitted to be stored, unlike Google photos. It only works for places famous enough to have good Commons coverage; use Google as the fallback for the rest.
