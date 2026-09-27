// How Landmark Hunters works, for Mapr's chat (api/plan-ai.js) to answer
// "how do I..." / "what is..." questions about the app itself. Kept in sync
// with how these features actually behave in the code (not aspirational
// copy) so Mapr never promises something the app doesn't do -- update this
// alongside any change that adds, renames or removes a user-facing feature
// or flow (see CLAUDE.md).
export const APP_HELP =
  `HOW LANDMARK HUNTERS WORKS (for questions about the app itself, not a landmark):\n` +
  `- Navigation: 5 tabs — Map, Landmarks, Mapr, Itinerary, Profile.\n` +
  `- AI features (Mapr chat, Mapr Picks, smart search, custom-interest matching) need you to be signed in. There's no daily limit. Mapr is the ` +
  `one AI assistant: ask it anything -- plans, questions about a place or city, or how the app works. Each landmark's page has an ` +
  `"✨ Ask Mapr about …" button with quick questions that opens the Mapr chat and asks there.\n` +
  `- Mapr knows where you are when location is on: it uses your phone's live location, so "near me" / "nearby" just works without ` +
  `naming a city. If location is off, it asks which city you're in. Every place Mapr suggests from the web has a Directions link that opens ` +
  `the same three choices as everywhere else (Use the Map, Google Maps, Apple Maps).\n` +
  `- Mapr chats: like Claude, you can have many chats. The bar at the top of Mapr shows the open chat's name (tap it to rename), ` +
  `☰ opens your chat list (search, open, rename, move to a project, delete) and ➕ starts a new chat. A new chat is named after ` +
  `your first message. Chats sync to your account, so they're on every device you sign in on. An "Edit" link under any message ` +
  `you sent lets you change it and resend -- that discards the old reply (and anything after it) and gets a fresh answer to the ` +
  `edited message, rather than adding a correction on top of the old thread.\n` +
  `- Mapr projects: group chats into a project (☰ → "📁 New project"). A project has a name and instructions Mapr follows in ` +
  `every chat inside it (budget, group size, what you're into). The owner can share a project with friends (⚙️ on the ` +
  `project → "Share with a friend"); everyone in it can read and continue its chats and edit the instructions, and the ` +
  `person added gets a notification. Only the owner can remove people or delete the project; deleting it keeps its chats ` +
  `as regular chats.\n` +
  `- Your progress is saved on this device as you go: the Mapr conversation, half-typed messages and questions, a landmark you were adding, a ` +
  `rating in progress, feature-request drafts, and your Landmarks search and sort come back if you close the app. Category filters (Map and Landmarks) last while the app is open and reset every launch, and Landmarks always opens on All Cities. If something fails to load or ` +
  `save, the app says what happened in plain words and shows a Try again button; nothing you typed is cleared.\n` +
  `- Trip planning (Plan Your Trip card and Create New Trip) fills in your starting location from your saved home address when home is in the ` +
  `city you picked, with a Clear option. "Use My Current Location" fills in the street address you're at (or the business, ` +
  `if you're standing in one). In city search, pressing Enter picks the top match.\n` +
  `- On the Map, landmarks you've checked into show as green pins. Opening the Map right after looking at an itinerary (solo or ` +
  `group) zooms it to fit every stop in that itinerary.\n` +
  `- Select all: on the Landmarks list, once you pick a single city, "✅ Select All" adds every landmark the current filters show to that ` +
  `city's itinerary ("Clear" undoes it). A group trip's "➕ Add Landmarks" card has "Select all" / "Clear all" too, for everyone in the trip.\n` +
  `- An open itinerary's stops (solo or group -- both work exactly the same way, group trips just have more people on them) have a "Sort by" ` +
  `dropdown: "Nearest to me" (a walkable route, not just closest-to-you-first), "My order" (whatever you last dragged it into), "Highest rated", ` +
  `"Quickest visits", "Free first". Hold the ☰ handle on any stop and drag it to reorder by hand -- doing that switches "Sort by" to "My order" ` +
  `automatically and remembers it. A group trip shows its stops the same way, under "🗺️ Your Route", with a separate "➕ Add Landmarks" card ` +
  `below it for browsing the rest of the city's catalog to add.\n` +
  `- Itinerary tab has two subtabs, Current and Past. An itinerary (solo or group) moves to Past on its own once you've ` +
  `checked into every landmark on it (places Mapr found on the web don't count, since they can't be checked into). Open one ` +
  `and tap "📦 Move to Past" or "↩️ Move back to Current" to move it by hand; for a group trip that only moves it for you. ` +
  `There's no sharing of past itineraries yet. A search bar at the top of the Itinerary tab finds an itinerary by city, country ` +
  `or name across both Current and Past.\n` +
  `- Landmarks list sorts three ways: "✨ For Me" (the default -- places that fit your taste first, closest first, using the same ` +
  `taste scores Mapr Picks uses, learned from your ratings, plus the interests you picked at signup), "📍 Near Me", and ` +
  `"🔥 Popular" (most popular first, blending how well-known a place is with ` +
  `community ratings). There's no Explored/Unexplored filter and no separate Top Rated sort anymore. Residence halls are ` +
  `under Campus Life; there's no separate Dorms category.\n` +
  `- You can edit your own comment on any landmark you've rated or checked into, from the "Your comment" box on its page.\n` +
  `- Itineraries (Itinerary tab): one per city, plus group trips. Each has a name; tap ✏️ next to the title to rename it. A solo itinerary ` +
  `shows a Members card with you and "➕ Add a user": search anyone by username or pick a friend, and the itinerary becomes a group trip ` +
  `you both can edit (same name, stops and places). In a group trip, any member can rename it, tick landmarks, and invite people with ` +
  `"➕ Add" at the bottom of the Members list; only the owner can remove members. "🗑️ Delete Itinerary" at the bottom of an ` +
  `itinerary deletes it after a confirm (its stops and name; check-ins and ratings stay), with an Undo right after. A group ` +
  `trip's owner has "Delete This Group Trip" there instead, also confirmed, and that one deletes it for everyone with no undo.\n` +
  `- Mapr's place recommendations (e.g. "good bowling near me") show as a grid of cards under its reply, one per place — not plain chat ` +
  `text. Each card shows a photo/category icon, the address, a short reason, distance from you once it's ready, and a Get Directions ` +
  `button (same three-choice picker as everywhere else) — no opening/closing hours on the card by default; ask Mapr directly ("what time ` +
  `does it close") and it answers in chat with just that day's hours unless you ask for the full week. Tapping any card opens that ` +
  `place's full landmark page right away: if it's a place Mapr found on the web that isn't already in the catalog, tapping it creates ` +
  `the real landmark on the spot (a couple seconds, shown right on the card) rather than requiring a separate step — same as one someone ` +
  `submits by hand: it shows up on the Map, in Landmarks, in search, everywhere, right away, and can be checked into, rated and ` +
  `commented on immediately. Needs a signed-in, verified-email account; if that's not met or the place can't be found, the card says so ` +
  `and tapping it again retries, with a Source link and Directions still working either way.\n` +
  `- Mapr can act on your itineraries when you ask in chat: "add it to my itinerary", "put both on my Philly trip", "remove Wynwood", ` +
  `"make a new itinerary for Miami called Spring Break", "rename my trip to …", "add @username to my Villanova trip". It works for places ` +
  `from the catalog and places it found on the web. Each action shows a ✅ confirmation under Mapr's reply with Open and Undo. Mapr never ` +
  `creates an itinerary on its own: anything that would start a new one shows "Start a new … itinerary?" with Create it / No thanks, and ` +
  `only happens if you tap Create it. It can't check in, rate, or change account settings ` +
  `for you.\n` +
  `- Tell Mapr you just left a place ("I just left the shooting range, where should I eat?") and it asks how it was: a card under ` +
  `its reply with "I loved it" / "It was okay" / "Not for me". One tap opens the usual rating (tier already picked, plus a ` +
  `short why) as a 0-point rating, no check-in needed -- works for catalog landmarks and for real places the app hasn't seen yet.\n` +  `- Mapr (the middle tab, app home screen): a live AI chat, opened every day — type or describe what you're up for (a vibe, a time budget, an ` +
  `interest) and it replies with 0-4 real stops, from the curated catalog or the live web. It reads your rating history and taste profile, so it ` +
  `personalizes from the first message, not just after you've rated things. It also weighs the CURRENT message's timing/mood ("Saturday night in the ` +
  `city") over a blanket favorite category — loving hiking doesn't mean it suggests a trail when you're clearly asking for nightlife. The city pill in ` +
  `its header supports picking several cities at once, not just one. A "🧭 Plan Your Trip" card (open it any time, or land on it automatically via ` +
  `Itinerary's "Use Mapr" button) lets you set a starting location, region, interests, mood (energized/active vs. easygoing/chill — the same ` +
  `place can be a yes on a lazy morning and a no on a Saturday night out), and solo/group in one place, then turns it into a normal chat message ` +
  `Mapr answers like any other.\n` +
  `- Taste Profile Score (shown on Mapr and Profile): NOT an activity counter — it's Mapr's own prediction confidence, measured by how well its ` +
  `affinity model can guess one of your ratings from your OTHER ratings alone (leave-one-out), shown as a percentage. Mapr Picks ✓/✗ votes count toward it at half the weight of a full rating. It only rises when predictions ` +
  `genuinely get more accurate, and a narrow (single-category) or inconsistent rating history plateaus it on purpose. Personal-only, never on any ` +
  `leaderboard. Has an Edit button that reopens the taste quick-pick questions pre-filled so you can change or add to your answers anytime.\n` +
  `- Taste baseline / "tell Mapr what you like" (Mapr, Settings, and an onboarding step): quick per-category like/hate chips (tap once for like, ` +
  `twice for dislike, three times to clear) plus an optional comment on each category and a free-text box — entirely optional, and typing/talking to ` +
  `Mapr directly works just as well. This baseline is what Mapr leans on before you've rated much; an actual rating on a specific landmark is more ` +
  `precise and wins if the two ever disagree.\n` +
  `- "Tell Mapr What You Love" (Settings): one free-text box for anything in your own words — categories, moods, or actual places and brands by ` +
  `name (e.g. "I love racing, steak, pickleball, Dunkin' Donuts, sushi, arepa places, marinas, Carrot Express"). Naming a specific place/brand tells ` +
  `Mapr something a category alone can't. Mapr reads it directly, no rating required.\n` +
  `- Insider Mode: unlocks automatically once the Taste Profile Score is confident enough (75%+) — Mapr's chat then leans toward lesser-known, ` +
  `off-the-beaten-path stops instead of the obvious tourist picks. Nothing to turn on manually, it just activates, and there's no badge or toggle ` +
  `for it anywhere -- it's just how the chat behaves once it's confident enough.\n` +
  `- Mapr chat plans for the time you're asking about, not the time you're typing: say "Saturday night" or "lunch tomorrow" and it favors ` +
  `nightlife or food for that slot on top of your learned taste; with no time given, it plans for right now.\n` +
  `- Mapr chat can offer a city's own specialty even outside your usual taste -- Rome's architecture and ruins, Paris's art museums, Tokyo's ` +
  `street food -- but only when you have no real signal either way in that category (no rating, nothing you've said you love or dislike), and only ` +
  `as a question with quick-tap Yes/No, not a silent addition. It never does this for a category you've told it you dislike, generally or for that city.\n` +
  `- Mapr Picks (on Profile): up to 10 landmarks Mapr thinks you'll love next at once, for the city you're in right now (or, once you've been to everything there, the nearest city with something new). Every rating updates a ` +
  `per-city score for that landmark's category ("I loved it" +10, "It was okay" +2, "Not for me" -15, kept between -100 and 100, fading by half every 90 days; after a category's first 5 ` +
  `ratings, each new one counts half). Rating also asks "How often do you come here?" (Not often / Sometimes / A lot, optional) -- "a lot" moves the score up to 1.6x as hard as "not often," both directions, since coming back ` +
  `often is stronger proof of taste than a rare visit. A ✓ or ✗ vote on a Mapr Pick moves that score too, more lightly (✓ +4, ✗ -6, and it doesn't count as one of the 5 ratings); "not sure" moves nothing. ` +
  `Mapr shortlists that city's 30 best-scoring places (no more than 12 from any one category, so one favorite can't crowd out the rest) and then picks the final ones with your recent ratings and own words in mind. If you tell Mapr (in ` +
  `the taste-intro free text) a city-specific exception -- "I don't usually like museums, but in Paris show me more" -- it honors that only when picking for that named city, even if it contradicts your general scores or ratings elsewhere. ` +
  `A few of the 30 are ` +
  `deliberate wildcards from categories you've barely rated, so Mapr can find new interests; a wildcard shows as "🎲 Something new" on its card. ` +
  `In a new city, Mapr starts from 40% of your scores from other cities and phases that out by your 15th rating there. With no ratings ` +
  `anywhere yet, it starts from your signup interests, most-visited places first. With no location, ratings or saved cities at all, the row shows ` +
  `the most-visited places across every city (within your signup interests first, if you picked any), and switches to your city the moment location loads or you pick one. A pick you actually scrolled to and looked at on 3 different days, ` +
  `without visiting, rating or voting on it, lowers that category a little (much less than "Not for me"); checking in later resets that count. When a category hits the cap, a one-time pop-up asks "You really ` +
  `love [category]. Want us to lean more into it?" -- Yes tilts picks toward it and lets it take up to 18 of the 30 shortlist spots (other categories still show up), No leaves it as is, and the ` +
  `optional comment box tells Mapr what you want more of there. It asks once per category, not once per city, and your answer applies in every city. Swipe to browse them. Only meant to hold things you'd clearly go to or clearly skip. Tap ✓ "I'd go" or ✗ "not for me" for a real, ` +
  `conclusive verdict -- that landmark won't be offered again. "🤷 Not sure" is different: it means "I genuinely don't know yet" (not a hidden ` +
  `dislike), drops that landmark out of the row and keeps it out for about a week, after which it can be recommended again. Voting on ` +
  `one pulls in a fresh pick to replace it, keeping the row at 10; swiping alone doesn't load more.\n` +
  `- Onboarding: right after creating an account, a one-time flow — pick your usual interests (or skip), an optional "tell Mapr what you like" taste ` +
  `step (or skip), the nearest real landmark to your GPS with a one-tap check-in, then an "Always Know Where You Are" step asking to upgrade ` +
  `location from "While Using" to "Always" (or skip). Reaching the check-in step — whether or not you check in — completes onboarding and awards ` +
  `the "Welcome" badge plus 10 bonus points; the location step comes after that and never blocks it.\n` +
  `- Background Location (Settings, and that onboarding step): opt-in, off by default. On means Mapr keeps getting your location even with the ` +
  `app fully closed (real background GPS via the native app, not a browser trick), so the moment you land in a new city it's already learning from ` +
  `it instead of starting cold the next time you open the app -- uses iOS's "Always" location permission and some extra battery. Off means Mapr ` +
  `only knows your location while the app is open, same as before this existed. Turning it on can be declined at the iOS permission prompt; the ` +
  `toggle says so and doesn't turn on if you decline.\n` +
  `- Trip Setup: no longer its own tab. The Itinerary tab's empty/overview state leads with "🧭 Use Mapr (recommended)", which jumps straight to ` +
  `Mapr's Plan Your Trip card (see above) — a "➕ Create New Trip" modal (same starting location/region/interests form, plus a full solo-vs-group ` +
  `flow with friend invites) is still there underneath it for anyone who wants the old non-chat form instead.\n` +
  `- Check-ins: open a landmark and tap its check-in button — repeat check-ins to the same place are allowed, each logged with its own timestamp. ` +
  `Points taper on repeats: full points on the 1st visit, about 20% on the 2nd-5th, nothing from the 6th on — but every visit still counts toward Mapr ` +
  `learning your taste regardless of payout. At the 3rd visit to a place (then every 10th after) you're asked why you love it, feeding that specific ` +
  `reason back into future recommendations.\n` +
  `- Rating: three plain tiers — "I loved it" / "It was okay" / "Not for me" — no star ratings anymore. A short "why" comment is encouraged since ` +
  `that's what actually teaches Mapr, more than the tier alone.\n` +
  `- Comments: every landmark page has a 💬 Comments section with your comment (at the top) and other people's. Only written ` +
  `comments show there -- a rating on its own doesn't count as a comment. Once you've checked ` +
  `in somewhere you can add or edit your comment any time later, with or without a rating -- from that section or from each row of ` +
  `My Check-ins (Profile → your check-ins). Other people's comments show when their account is public or they're your friend.\n` +
  `- My Check-ins has a search box: type a place, city, something from your comment, your rating ("loved") or a date.\n` +
  `- Every search box (Map, Landmarks, My Check-ins, Rate a Landmark, city pickers) forgives spelling: typos, swapped or missing ` +
  `letters, half-typed words, sound-alike spellings ("filadelfia"), and accents. Best matches come first. When that still finds ` +
  `little and you're signed in, Mapr works out what you meant from a description, nickname or what a place is known for ("the big ` +
  `clock in London", "Rocky steps", "the city with the Eiffel Tower") and shows those under "✨ Mapr thinks you mean".\n` +
  `- Badges: not shown on Profile itself (that screen is deliberately kept simple) — see them all at Profile → "See Full Stats". Earned ` +
  `automatically from your check-in history — total check-ins (First Steps, Explorer, Adventurer, Legend), distinct cities visited (City Hopper, ` +
  `Globetrotter), daily check-in streaks (3/7/30-Day Streak), and the one-time Welcome badge from onboarding.\n` +
  `- Levels: your level rises with lifetime points and only ever goes up; a level-up shows a celebration popup. Points and the leaderboard are ` +
  `intentionally de-emphasized in the UI now — Mapr and your taste profile are the headline, not the score.\n` +
  `- Time saved / discovery: Mapr shows real, tracked numbers — minutes saved today, summed from actual Mapr chat replies that produced stops, each ` +
  `compared against a stated manual-planning baseline (never a made-up estimate).\n` +
  `- Streaks: check in on consecutive days, or rate a few things through Mapr Picks, to build a streak; Profile warns if an active streak is about to ` +
  `lapse, and the streak warning in Notifications shows a live countdown to when it expires. Tapping the 🔥 streak in the top middle of the header shows a live countdown too. ` +
  `Streak days run midnight to midnight in the traveler's local time, so the countdown is never more than 24 hours: before today is secured it's time left to save the streak, after that it's time until the next day starts.\n` +
  `- Map category filter: tap the 🗂️ button on the Map, then the "All landmarks" dropdown, to search categories and tap to show or hide them.\n` +
  `- Ranks / Leaderboard (also a Profile section, now secondary to Mapr/taste stats): a Friends/Global toggle — Friends ranks you against people you ` +
  `follow, Global splits into Worldwide and Regional (one curated city). Each has Weekly/Monthly/Yearly views.\n` +
  `- Inviting friends: Profile has an "Invite Friends" button that shares your username/link; once someone signs up through it, both of you get 50 ` +
  `bonus points (credited quietly into your point total — there's no separate referral display anymore).\n` +
  `- Directions: every "Get Directions" button in the app (Map tab pins, Landmarks list, a landmark's page, itineraries) opens the same ` +
  `choice: "🗺️ Use the Map", "🌐 Use Google Maps", or "🍎 Use Apple Maps". "Use the Map" keeps you in the app: it draws the real road ` +
  `route from your live location with turn-by-turn steps, total distance and ETA (on the Map tab, or right on the itinerary's own map when ` +
  `you're in an itinerary). Short hops (about 1.2 km / 0.75 mi or less) are walking directions; longer ones are driving, with the ETA ` +
  `including live traffic and a note on how many minutes traffic is adding. On the Map tab it needs location turned on; on an itinerary, ` +
  `if you're planning from far away it shows the leg from the previous stop instead. "Refresh from Here" re-routes from where you are ` +
  `now, and "Open in Maps App" hands off to Google or Apple Maps. Once real turn-by-turn is up, the route draws in green and the ` +
  `satellite map around it dims, so the way stands out (the map is a photo, so individual real-world roads can't be recolored -- only ` +
  `the route the app draws itself can be).\n` +  `- Live navigation, like Apple Maps: once the route is up, tap ▶ Start. The map follows you at street level, the next turn and a ` +
  `live distance countdown sit at the top, and time left, distance and arrival time at the bottom. It speaks each instruction ` +
  `(🔊 to mute), keeps the screen on, re-routes automatically if you go off the route, and says when you've arrived. Drag the map ` +
  `to look around, then 📍 to recenter; End stops it.\n` +
  `- Itineraries show each stop's street address and, between stops, how long each leg takes and whether it's a walk or a drive. ` +
  `"▶ Start Trip" runs live navigation through the stops you haven't checked into yet, in list order -- arriving at one offers ` +
  `"Next: …" for the following stop. "All stops in Google Maps" opens the whole route, every stop in order, in Google Maps.\n` +
  `- Each stop on an itinerary or group trip shows its street address under its name.\n` +
  `- Group Trips: a shared itinerary a few friends can all see and edit together (only the trip's owner can change who's a member). ` +
  `"🗺️ View in Map" next to Your Route opens the Map with the trip's stops numbered in the most efficient order from where ` +
  `you are, the route drawn between them, and ▶ Start for live navigation through them (plus "All stops in Google Maps").\n` +
  `- Adding a landmark that's missing (Add Landmark screen): any signed-in account with a verified email can submit one (verify it from the ` +
  `link emailed at sign-up; Settings can resend it). It shows up on the map for everyone right away. While typing the name or address, ` +
  `it warns you if that spot looks like it's already on the map (with a link to view the existing one) so you don't add a duplicate -- ` +
  `purely a heads-up, not a block, so you can dismiss it and submit anyway if it's really a different place.\n` +
  `- You can also add one through Mapr just by saying "make a landmark for where I am" (or "add this place", "create a landmark here"). ` +
  `Mapr looks up the real place at your exact GPS location and asks "Just to confirm -- you're at [name], right?" before creating ` +
  `anything; say no and name the actual place ("no, I'm at the visitor center") and it looks that up instead and asks again. Needs ` +
  `location on and the same signed-in, verified-email account as Add Landmark.\n` +
  `- "Nearby Now" (on the map screen): an expandable panel showing landmarks close to your current location right now.\n` +
  `- Offline maps: a "Download for Offline" option caches a region's map tiles so the map still works without a connection.\n` +
  `- Habit tracking (on by default, toggle in Settings): while the app is open, Mapr notices places you keep actually visiting -- three or more different days at the same spot -- and, next time you're standing there, asks "You keep going here, want to add it to an itinerary?" with options to add it, say it's already there, snooze it, or stop tracking that spot. It also checks whether something matching your taste (an interest, or what you've told Mapr you love) is worth a stop near there or on the way -- e.g. spotting a shooting range nearby if you love shooting -- and offers to add that too, only when it has a genuinely good match. Entirely on-device: raw location history never leaves your phone, only the one place name it resolves once a spot has become a real pattern, plus that one taste-match question sent the same way a normal Mapr chat message is. It only notices patterns while the app is open (there's no real background location or push notification support), and it also drops a note in your in-app Notifications.\n` +
  `- Settings: switch dark/light mode, switch units between imperial (mi/ft) and metric (km/m), toggle your profile between public (reviews/photos ` +
  `visible to everyone) and private (friends only), set a home address (used for taste learning), edit the taste baseline described above, change your ` +
  `password (for email/password accounts), and (at the very bottom) Request a Feature, Privacy Policy & Terms of Service, and the date you joined. All ` +
  `account-level actions live in Settings now, not on Profile. There's no self-serve account deletion right now.\n` +
  `- Sign in options: you can create an account and sign in with an email and password, or use Google Sign-In. Google Sign-In uses your Google account ` +
  `for authentication and doesn't require a separate password here.\n\n`;
