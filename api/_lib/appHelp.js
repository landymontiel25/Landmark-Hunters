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
  `- Trip planning (Plan Your Trip's "Type an address" step and Create New Trip) fills in your starting location from your saved home address when home is in the ` +
  `city you picked, with a Clear option. "Use My Current Location" fills in the street address you're at (or the business, ` +
  `if you're standing in one). In city search, pressing Enter picks the top match.\n` +
  `- On the Map, landmarks you've checked into show as green pins. Opening the Map right after looking at an itinerary (solo or ` +
  `group) zooms it to fit every stop in that itinerary.\n` +
  `- "Picked for you right now" (Mapr's nearby picks, on the Map tab): signed in, a sheet sits over the bottom of the live map. It has two states: open (about half the screen) and tucked away to just its title. Drag the handle and the sheet moves with your finger; let go and it settles on the nearer state (a quick flick goes the way you flicked). Tapping the handle also tucks it away or brings it back. Open, it shows "What are you in the mood for?" on top (Something to eat, Entertainment, Some history, Art & museums, Fresh air, A night out which means bars, clubs and live music, Sports; sorted Closest or Highest rated), and under it one card "Picked for you right now" with your top 3 picks near where you are (photo, name, distance, a one-line reason and a Directions button each), a ↻ refresh button beside the title that shows different places (unseen ones first, then ones you saw), and a "Within N mi" pill that shows the distance in use. Picks are mostly "Your usual" (kinds of places your ratings already love) plus one "Something new" (refresh fills in more new places). Places you rated "I loved it" come first, up to two of them, whenever you are within a mile of one (not when you are standing at it, and not when it is closed), tagged "You loved this". If you usually go from one kind of place straight to another (3+ times, back to back within 3 hours), the next pick can follow that habit. Tap any pick for "🧭 Directions" or "📍 Open landmark page". The Within chips (1, 2, 5, 10, 25, 50, 100 style options in miles or km to match your Units setting) set how far Mapr looks: it starts at 5 mi (10 by default when location is unknown), and once you tap a chip the app remembers your choice. This distance is separate from the map's own zoom radius dropdown. Nearer places rank higher when two fit your taste about equally, and places someone added by hand (Add a landmark) are included. If fewer than 3 places fit inside the chosen distance, the sheet says so, names the nearest places just past it with their distances, and has a one-tap "Widen to N mi" button. Mapr only lists places in its catalog, which is thinner in some areas than others. Picks skip places that are closed right now, and places you have already rated AND visited unless you loved them and they are within a mile (a place you rated without ever checking in still counts as somewhere new to go, unless you rated it "I didn't like it"). A place with no stored photo is still picked: its tile looks up a photo when it appears (with the photographer credited) or shows a colored category tile. It needs 10 ratings first (a new account sees "Rate 10 places and Mapr will start ` +
  `picking for you"; the number counts down as you rate, e.g. "Rate 1 more place", with a "Rate places" button that opens the Landmarks tab where every row has a quick-rate button, and the Trip planner's "The usual"/"Something new" lock counts down the same way) and location turned on ("Turn on location to see picks near you"). A set is kept for 4 hours; an older one ` +
  `stays on screen with "Updating…" while a new one loads, and offline your last picks stay up. It hides while directions, a ` +
  `trip route, the search or category panel, or pin placement is open. No notifications, no background location.\n` +
  `- Select all: on the Landmarks list, once you pick a single city, "✅ Select All" adds every landmark the current filters show to that ` +
  `city's itinerary ("Clear" undoes it). A group trip's "➕ Add Landmarks" card has "Select all" / "Clear all" too, for everyone in the trip.\n` +
  `- An open itinerary's stops (solo or group -- both work exactly the same way, group trips just have more people on them) are just always sorted ` +
  `"Nearest to me" automatically (a walkable route, not just closest-to-you-first) until you've customized the order -- nothing to pick, no dropdown, ` +
  `that's simply the default. An "✏️ Edit List" button switches every stop to an edit layout, same idea as iOS Weather's location list: a red "−" ` +
  `on the left removes that stop (no separate trash icon in this mode), and a ☰ handle on the right is what you hold and drag to reorder (or focus and press the Up/Down arrow keys) -- the card ` +
  `follows your finger and the others slide out of the way live, not a jump to the new spot. Tapping "✅ Done" saves that order. Only once you've ` +
  `used Edit List at least once does a "Sort by" dropdown appear (Nearest to me / My order), so you can flip back to automatic distance sorting ` +
  `without losing the custom order you built -- it's remembered, ready the next time you pick My order again. A group trip shows its stops the ` +
  `same way, under "🗺️ Your Route", with a separate "➕ Add Landmarks" card below it for browsing the rest of the city's catalog to add.\n` +
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
  `- You can edit your own comment on any landmark you've rated or checked into, from the "Your comment" box on its page (always together with a rating tier).\n` +
  `- Itineraries (Itinerary tab): one per city, plus group trips. Each has a name; tap ✏️ next to the title to rename it. A solo itinerary ` +
  `shows a Members card with you and "➕ Add a user": search anyone by username or pick a friend, and the itinerary becomes a group trip ` +
  `you both can edit (same name, stops and places). In a group trip, any member can rename it, tick landmarks, and invite people with ` +
  `"➕ Add" at the bottom of the Members list; only the owner can remove members. "🗑️ Delete Itinerary" at the bottom of an ` +
  `itinerary deletes it after a confirm (its stops and name; check-ins and ratings stay), with an Undo right after. A group ` +
  `trip's owner has "Delete This Group Trip" there instead, also confirmed, and that one deletes it for everyone with no undo. A group trip ` +
  `holds up to 25 people (including you); the friend picker and Add button stop there with a note. Places Mapr found on the web that were added to a group trip are listed in its own "Places From Mapr" card (with ` +
  `Directions and a remove button), separate from the numbered route. Once you've checked into at least one landmark on a solo itinerary, a ` +
  `"🎬 Trip Recap" button appears there: a shareable card with how many landmarks you visited and the points earned (group trips don't have one).\n` +
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
  `its reply with "I loved it" / "Ok" / "I didn't like it". One tap opens the usual rating (tier already picked, plus a ` +
  `short why) as a 0-point rating, no check-in needed -- works for catalog landmarks and for real places the app hasn't seen yet.\n` +  `- Mapr (the middle tab; the Map tab is the home screen): a live AI chat — type or describe what you're up for (a vibe, a time budget, an ` +
  `interest) and it replies with 0-4 real stops, from the curated catalog or the live web. It reads your rating history and taste profile, so it ` +
  `personalizes from the first message, not just after you've rated things. It also weighs the CURRENT message's timing/mood ("Saturday night in the ` +
  `city") over a blanket favorite category — loving hiking doesn't mean it suggests a trail when you're clearly asking for nightlife. The city pill in ` +
  `its header supports picking several cities at once, not just one. "🧭 Plan Your Trip" (open it any time, or land on it automatically via ` +
  `Itinerary's "Use Mapr" button) is a short step-by-step chat with Mapr — one question at a time as a Mapr bubble with big tap buttons: ` +
  `(1) where you're starting ("Use my current location" or "Type an address"; the city fills in from that, and it only asks for a city if ` +
  `location is off or the address can't be found), (2) mood — Energized & Active or Easygoing & Chill (the same place can be a yes on a lazy ` +
  `morning and a no on a Saturday night out), (3) "What sounds good?" — "The usual" (places ranked by your saved taste) or "Something new" ` +
  `(kinds of places you've rated little or never that still fit your taste), plus an optional "Anything specific?" box; with fewer than 10 ` +
  `ratings only the box shows, (4) Solo or Group, then (5) "Plan my trip", which first asks "Who is this plan for?" (Just me or A group) and then turns the answers into a normal chat message Mapr answers like ` +
  `any other (group trips work the same as before). Tapping an answer moves on by itself; steps with a text box have Next. Every step has Back, ` +
  `progress dots, Close and "Just browse the map", and every step but the first has Skip. Answers are saved as you go, so closing the app ` +
  `picks up on the same step. Planning the exact same trip again from the same spot in the same part of the day shows the last plan again ` +
  `instead of re-planning. Interest chips and "Use My Preferences" are no longer part of this flow; My Preferences is still editable in Settings.\n` +
  `- Taste score (the "Taste Profile" card on the Mapr tab, not Profile; it reads "Mapr knows your taste: N%" with a bar that is red under 40%, yellow from 40% to 69% and green from 70%, with the number beside it and a word like Strong or Getting there): how often Mapr's own quiet guess about a place it suggested matched your answer. ` +
  `Mapr keeps a hidden guess for each pick it shows you, and only after you answer (a rating, or an "I'd go" / "Not sure" / "Not for me" tap, whichever is your newest answer on that place) ` +
  `is it compared. The score looks at your last 20 such guesses: same answer is a full hit, one step off (say a guess of I'd go against It was ok) counts half, two steps off (I'd go against ` +
  `Didn't like it) counts nothing, and an "I'd go" tap followed by "Didn't like it" counts as half a miss because Mapr had your kind of place right and the specific place wrong. It shows "Learning..." until ` +
  `5 guesses have been answered (if you already have enough past ratings, it instead shows "~N%, estimated from your past ratings": a quick on-device replay of how well Mapr would have guessed each of your earlier ratings from the ones before it; that estimate is only a placeholder, is not saved anywhere, and the real score replaces it after 5 answered guesses), never goes above 99% until your last 100 guesses were all full hits (then 100%), and follows your newest answer, so re-rating a place can change it. ` +
  `You never see what Mapr guessed for a pick before you answer. Guesses made for a group request (below) don't count. Personal-only, never on any leaderboard. The card's Edit button reopens the taste quick-pick questions pre-filled so you can change or add to your answers anytime. Mapr keeps a private history of your score over time, deleted with your account.\n` +
  `- "Who is this for?": only Plan Your Trip asks it, on its last step after "Plan my trip" ("Just me" or "A group"), each time; it isn't remembered. Typed messages, quick replies, "Ask Mapr about..." and edited messages go straight to Mapr and always work as "Just me". "A group" makes Mapr follow exactly what you asked for (say, family bowling) and ignore your usual taste, your ratings, saved interests, ` +
  `taste notes and Insider Mode when choosing places; Plan Your Trip also skips "The usual" / "Something new" for a group. Taps and check-in ratings count toward your taste the same either way.\n` +
  `- How Mapr learns from you: only from your ratings, your taps on a pick ("I'd go" / "Not sure" / "Not for me") and the comments you write on a rating. ` +
  `A good answer (I loved it, I'd go) raises that place and its kind of place; a bad one (I didn't like it, Not for me) lowers them; a neutral one (It was ok, Not sure) barely ` +
  `moves them. A tap counts for less than a rating. Words in a comment count too ("too loud" lowers loud kinds of places, "great food" raises food; "not loud" doesn't lower ` +
  `anything), up to a small cap per rating. Mapr keeps two scores: one for the specific place and one for its kind (food, history, ...), so one bad restaurant doesn't ` +
  `condemn all food. If you tap "I'd go" and then rate it "I didn't like it", that place drops a lot, its kind only a little, and Mapr counts it as half a miss on its own ` +
  `guess. Changing your tap, rating or comment later replaces the old answer's effect. If your new answer on a place is two levels from your own earlier one (I'd go then Didn't like it, ` +
  `or I loved it then Didn't like it, either way), Mapr asks once "Your answer changed a lot. What happened?" with buttons Food, Service, Price, Noise or crowd, I changed my mind, ` +
  `First visit was a one-off, I was wrong about this type of place, Other, a note box and Skip (it skips the question when your comment already says, e.g. "too loud" or "overpriced"). ` +
  `Food, Service, Price and Noise or crowd keep the change on that one place only and leave its kind of place alone; I changed my mind and I was wrong about this type of place let the new ` +
  `answer count fully, kind of place included; First visit was a one-off treats both answers as in-between; Skip (and Other) count the new answer 70% and the old one 30%. A one-level change ` +
  `(I loved it then It was ok) asks nothing. Mapr also remembers when you first rated a place and what your previous answer was. A check-in rating counts the same whether you went alone or with a group. Your per-place scores ` +
  `are private to you and are deleted with your account.\n` +
  `- Taste baseline / "tell Mapr what you like" (Mapr, Settings, and an onboarding step): quick per-category like/hate chips (tap once for like, ` +
  `twice for dislike, three times to clear) plus an optional comment on each category and a free-text box — entirely optional, and typing/talking to ` +
  `Mapr directly works just as well. This baseline is what Mapr leans on before you've rated much; an actual rating on a specific landmark is more ` +
  `precise and wins if the two ever disagree.\n` +
  `- "Tell Mapr What You Love" (Settings): one free-text box for anything in your own words — categories, moods, or actual places and brands by ` +
  `name (e.g. "I love racing, steak, pickleball, Dunkin' Donuts, sushi, arepa places, marinas, Carrot Express"). Naming a specific place/brand tells ` +
  `Mapr something a category alone can't. Mapr reads it directly, no rating required.\n` +
  `- Insider Mode: unlocks automatically once Mapr's separate internal confidence about your taste (measured by how well it can guess one of your ratings from your other ratings; it is not the percentage on the Taste Profile card) reaches 75% — Mapr's chat then leans toward lesser-known, ` +
  `off-the-beaten-path stops instead of the obvious tourist picks. Nothing to turn on manually, it just activates, and there's no badge or toggle ` +
  `for it anywhere -- it's just how the chat behaves once it's confident enough.\n` +
  `- Mapr chat plans for the time you're asking about, not the time you're typing: say "Saturday night" or "lunch tomorrow" and it favors ` +
  `nightlife or food for that slot on top of your learned taste; with no time given, it plans for right now.\n` +
  `- Mapr chat can offer a city's own specialty even outside your usual taste -- Rome's architecture and ruins, Paris's art museums, Tokyo's ` +
  `street food -- but only when you have no real signal either way in that category (no rating, nothing you've said you love or dislike), and only ` +
  `as a question with quick-tap Yes/No, not a silent addition. It never does this for a category you've told it you dislike, generally or for that city.\n` +
  `- Mapr Travel Picks (on Profile): city-first, not AI-suggested -- pick a city (it defaults to wherever you are right now, or your most recent ` +
  `saved city with no GPS fix) and swipe through up to 10 of that city's landmarks you haven't voted on, rated, or checked into yet, most-visited ` +
  `first. Since these are places you haven't necessarily been, each card asks "would you go?", not "how was it?" -- tap "✓ I'd go" / "🤷 Not sure" / ` +
  `"✗ Not for me" right on the card. This is the exact same lightweight ✓/✗/🤷 vote every Mapr Pick has always used: no check-in, no modal, nothing ` +
  `to post. The same three buttons are on every pick Mapr shows you: the cards in the Map tab's "Picked for you right now" sheet, and the places ` +
  `Mapr suggests in the Mapr tab (trip planner and chat). A tap is saved to your account first and the button only lights up once it is saved; ` +
  `if saving fails you see "Couldn't save your answer" with a Try again button, and with no connection it says "Not saved yet" and sends when ` +
  `you are back online. "✗ Not for me" removes the card and the next pick takes its place (that landmark won't be offered here again); ` +
  `On the Map sheet and in the Mapr tab "✓ I'd go" and "🤷 Not sure" keep the card, shown as selected, and you can tap a different button to change your answer; in Mapr Travel Picks on Profile every answer (I'd go, Not sure, Not for me) takes the card away once it is saved, because it is answered. In a city you are new to, Mapr's hidden guesses lean on what you love in other cities until you have rated a few places there (the more you rate in that city, the more your own taste for it takes over). Travel Picks count toward your taste like every other Mapr pick: each card gets a hidden guess when it scrolls into view, and your answer is compared with it for your taste score (and the tag scores and place score move as before). ✓ and ✗ nudge that ` +
  `city's tag scores; "🤷 Not sure" carries no signal and Mapr Travel Picks offers that place again after about a week (there is no "ask me ` +
  `again" button or text). The first card in the row is always "+ Rate a ` +
  `Landmark" (search any place by name for the real rate-and-post flow, with a comment, that actually shows on the landmark's page).\n` +
  `- Voting ahead of a trip: to vote on places in a city you haven't been to yet, open Mapr Travel Picks and pick that city -- the same swipe row ` +
  `works for a city you're planning as well as the one you're in; there's no separate "prep a trip" feature anymore.\n` +
  `- Onboarding: a short flow that teaches Mapr your taste. New accounts get it right after creating an account and verifying their email (a "Verify your email" screen waits until the emailed link is tapped). New accounts go straight to a "Rate 10 places" step (the swipe cards are optional and can be done any time later, see below). The swipe cards (39 of them, from the banner or notification) run as: a welcome screen, how-to-swipe instructions, all 39 swipe cards, one category at a time (Food, History & Culture, Parks & Nature, Entertainment, Sports & Activities, then Local Life) (swipe right or tap the heart for love it, swipe left or tap the X for don't like it, tap the card or the minus for not sure), an "Anything else?" box for anything in your own words (the same text as "Tell Mapr What You Love" in Settings), then the "Rate 10 places" step. For new accounts the order is: Rate 10 places, then an optional "Your first check-in" step, and, in the iOS app, an "Always Know Where You Are" step asking to upgrade location from "While Using" to "Always" (or skip). The rate step shows one place at a time (photo or category tile, name, neighborhood or distance, a one-line summary) with a "3 of 10" progress bar, counting ratings you already have, and three big buttons: "I loved it", "Ok", "I didn't like it" (one tap saves a real rating, no comment form, no check-in needed). "Haven't been / not sure" skips that place without counting or saving anything, and a small "Do this later" link leaves the step (the Map's picks sheet then shows its "Rate N more" countdown). Places come from near your location when it is on (closest well-known places, a mix of categories leaning toward what you loved on the swipe cards), otherwise the most popular places in your city or overall, never repeating one. At 10 ratings it says Mapr can pick for you and continues; accounts that already have 10 skip the step. The first check-in step shows only to new accounts with no check-in yet, after the 10 ratings, and only lists places you are actually standing at (inside the place's check-in radius, with a usable GPS fix); if none is nearby or location is off it just says so and offers "Skip for now". It is always skippable, and rating a place does not count as a visit. Check-ins still work from the Map and landmark pages any time. Every step except the email check has a Skip button (or "Do this later"), and progress is saved to your account, so closing the app and coming back resumes where you left off. Loved cards also become your saved preferences for Trip Setup. What you swipe and write is saved to your account and Mapr uses it for its very next picks. Onboarding (the swipe cards) counts as finished once every one of the cards has an answer (the notes and the rate step don't count toward it); skipping the cards saves what you answered but doesn't finish it. Finishing awards the one-time "Welcome" badge plus 10 bonus points to accounts that never got it. When the onboarding is updated, everyone who hasn't done the current version gets an in-app notification, "Onboarding has been updated. Finish it to get better picks from Mapr." (Notifications, with the red badge; tapping it opens onboarding). It stays unread and comes back every time you open the app until you finish the flow, so opening it and leaving doesn't clear it, plus a "Finish the swipe cards to get better picks from Mapr" banner right under the top bar on the Map tab (and at the top of Mapr). The banner has an X that hides it until the next time the app is opened; the notification stays until the cards are finished, including for people who skipped them at sign-up. Nothing locks the app, and answers you gave before are pre-filled. Admins also have a Test tab sandbox for the same flow that saves nothing.\n` +
  `- Background Location (Settings, and the last onboarding step in the iOS app only; the website skips that step): opt-in, off by default. On means Mapr keeps getting your location even with the ` +
  `app fully closed (real background GPS via the native app, not a browser trick), so the moment you land in a new city it's already learning from ` +
  `it instead of starting cold the next time you open the app -- uses iOS's "Always" location permission and some extra battery. Off means Mapr ` +
  `only knows your location while the app is open, same as before this existed. Turning it on can be declined at the iOS permission prompt; the ` +
  `toggle says so and doesn't turn on if you decline.\n` +
  `- Push Notifications (Settings): opt-in, off by default, and infrastructure only right now -- nothing in the app sends one yet (that's coming with ` +
  `the shared streak feature). Turning it on asks for the iOS notification permission and registers this device; a "Send test notification" button ` +
  `appears once it's on, to check the whole pipeline actually works.\n` +
  `- Trip Setup: no longer its own tab. The Itinerary tab's empty/overview state leads with "🧭 Use Mapr (recommended)", which jumps straight to ` +
  `Mapr's Plan Your Trip chat (see above) — a "➕ Create New Trip" modal (a one-page starting location/region/interests form, plus a full solo-vs-group ` +
  `flow with friend invites) is still there underneath it for anyone who wants the old non-chat form instead.\n` +
  `- Check-ins: open a landmark and tap its check-in button, then Post (Cancel records nothing) — repeat check-ins to the same place are allowed, each logged with its own timestamp. ` +
  `The usual "you're here" radius is 30 m, but right now the app does NOT require being near the place to check in. ` +
  `Only your very first check-in ever pays points (100 points on the 1st visit); every check-in after that, at any place, pays nothing, because check-ins are for Mapr — every visit still counts toward Mapr ` +
  `learning your taste regardless of payout. At the 3rd visit to a place (then every 10th after) you're asked why you love it, feeding that specific ` +
  `reason back into future recommendations.\n` +
  `- Rating: three plain tiers — "I loved it" / "Ok" / "I didn't like it" — no star ratings anymore, framed as a question about the place ` +
  `("Do you like Peruvian food?", "Do you like this sports bar?", "Do you like the racing?"). Newly added community landmarks get that specific ` +
  `wording from the research done when they're added; catalog landmarks get a general one per category ("Do you like the food here?"). The ` +
  `comment box asks "What do you like about this place?" ("What didn't you like..." for "I didn't like it") and is encouraged since that's what ` +
  `actually teaches Mapr, more than the tier alone. Every rating (and every comment) carries one of the three tiers: there are no comment-only ` +
  `reviews, so a comment can only be saved together with a tier (an older comment-only one asks you to pick a tier the next time you edit it). ` +
  `Up to 4 aspects can be ranked per list: "I loved it" ranks what made it great, "I didn't like it" ranks what let it down, and "Ok" shows both ` +
  `lists over the same four aspects, where an aspect can be in only one of them. You can rate a place WITHOUT checking in (the Rate button on the Map, ` +
  `Landmarks list and itinerary stops, and the "Rate this place" card on a landmark's page, plus Rate a Landmark) -- it teaches Mapr just the same, ` +
  `but it does not count as a visit: not for check-in counts, streaks, the leaderboard, cities, or "places you've been". When you later really ` +
  `check in there, the check-in prompt asks you to rate again (your earlier answer is the starting point) and that new rating replaces the earlier one.\n` +
  `- Comments: every landmark page has a 💬 Comments section with your comment (at the top) and other people's. Only written ` +
  `comments show there -- a rating on its own doesn't count as a comment. You can add or edit your comment any time later, but it is always saved ` +
  `together with a rating tier (the editor asks you to pick one if you have none yet) -- from that section or from each row of ` +
  `My Check-ins (Profile → your check-ins). Other people's comments show when their account is public or they're your friend.\n` +
  `- My Check-ins has a search box: type a place, city, something from your comment, your rating ("loved") or a date.\n` +
  `- Every search box (Map, Landmarks, My Check-ins, Rate a Landmark, city pickers) forgives spelling: typos, swapped or missing ` +
  `letters, half-typed words, sound-alike spellings ("filadelfia"), and accents. Best matches come first. When that still finds ` +
  `little and you're signed in, Mapr works out what you meant from a description, nickname or what a place is known for ("the big ` +
  `clock in London", "Rocky steps", "the city with the Eiffel Tower") and shows those under "✨ Mapr thinks you mean".\n` +
  `- Badges: not shown on Profile itself (that screen is deliberately kept simple) — see them all at Profile → "See Full Stats" (earned in color, the rest grayed). Earned ` +
  `automatically: total check-ins (1/5/10/25/50/100: First Steps, Explorer, Adventurer, Legend, Expedition, Cartographer), cities (2/3: City Hopper, ` +
  `Globetrotter), states and countries, daily check-in streaks (3/7/30-Day Streak), the one-time Welcome badge from onboarding, plus activity ones ` +
  `(photo check-ins, a first review, adding landmark facts, 5 friends, top-10 leaderboard, trip planning, night owl / golden hour check-ins, and more).\n` +
  `- Levels: level N unlocks at (N-1)² × 100 lifetime points (level 2 at 100, level 3 at 400) and only ever goes up; a level-up shows a celebration popup. Points and the leaderboard are ` +
  `intentionally de-emphasized in the UI now — Mapr and your taste profile are the headline, not the score.\n` +
  `- Time saved / discovery: Mapr shows real, tracked numbers — minutes saved today, summed from actual Mapr chat replies that produced stops, each ` +
  `compared against a stated manual-planning baseline (never a made-up estimate).\n` +
  `- Solo Streak (single 🔥 in the header, and Your Stats' "streak" tile on Profile -- Profile shows ONLY the solo count, not the dual one): your ` +
  `own personal streak, a real stored Firestore doc (mode: "solo") the same as a dual streak, not just a computed display -- so it supports its own ` +
  `freeze and points. The day counts when you answer 3 different landmarks today, either the 3 daily cards on the Streaks page or any 3 in Mapr Travel Picks on Profile (I'd go, Not sure or Not for me; no check-in path -- answering is the whole rule; no guess step, ` +
  `since there's no partner to guess about). Mapr Travel Picks shows an "N/3 today" counter beside its title that updates the moment each answer saves and turns green with a check at 3, and the streak day closes then, so the red "Rate 3 landmarks today" warning flips to "streak is safe" without a reload. 1 personal freeze per month, spendable from the streak's own detail page. Rating a day earns 20 points, ` +
  `plus a milestone bonus (100 at day 3, 300 at day 7, 1000 at day 30). Everyone who already had a solo streak kept their exact count and best when ` +
  `this shipped -- it was seeded once from their real history the first time their account touched the app after the change, never reset to 0.\n` +
  `- Streak counts (solo and dual) show 0 as soon as a day has been missed with no freeze covering it, instead of lingering at the old number until the ` +
  `next rating. A freeze holds the day on the traveler's own local calendar (not UTC), and a fully-rated day that failed to register retries on reopening the streak page.\n` +
  `- Dual Streaks (🔥🔥, two flames, in the header next to the solo streak's single 🔥 -- not shown on Profile's Your Stats tile, only reachable via ` +
  `the header or the Streaks page's own Dual tab): a SEPARATE streak that belongs to a PAIR of friends, independent of the solo streak above -- you ` +
  `can have both going at once, and starting one never touches or resets your solo streak.\n` +
  `- Streaks page: Profile's "streak" tile, or the header's single 🔥 or 🔥🔥, all open the same real page (not a popup, same as check-ins/cities) ` +
  `with the two streak types kept apart as SOLO and DUAL subtabs rather than one mixed list -- they're different enough (no partner/guess step, its ` +
  `own single freeze, its own rules) that mixing them read as confusing, and a solo streak accidentally showing up in the dual list was a real bug ` +
  `this fixed. Solo shows directly under its own tab (there's only ever one); Dual keeps a list, since a pair can have up to 3 active dual streaks ` +
  `going at once. From the Dual tab, "Start a Dual Streak" picks a friend right there (streak-first, not friend-first) -- also reachable from an ` +
  `"Add a friend to turn this into a dual streak" banner on the Solo tab, which starts a brand-new dual streak at 0 rather than converting the solo ` +
  `one. To stop a dual streak, tap the trash icon next to that friend's name on the Dual tab's list -- immediate, no penalty beyond one "are you ` +
  `sure" (a streak's detail page also has "Leave streak" and "↺ Reset to 0", which asks you to type RESET and keeps your best). Dual days are worth more than solo ones: 50 points per day plus a bigger milestone bonus (200 at day 3, 600 at day 7, 2000 at day 30), ` +
  `split so BOTH partners get it once the day genuinely closes, not just whoever's device happened to trigger the close.\n` +
  `- Today's 3 shared landmarks: shown as a swipeable carousel, same style as Mapr Travel Picks. Mapr picks the city (same default-location logic ` +
  `Mapr Travel Picks itself uses, no manual city picker -- the user never chooses it) and the 3 landmarks (deterministically, so both people see the ` +
  `exact same 3 with no server round-trip deciding it). Tap a card's photo/name to open that landmark's own page, same as tapping a Mapr Travel ` +
  `Picks card. Two full phases, not per-card: first, rate all 3 (I'd go / Not sure / Not for me -- same wording as Mapr Travel Picks). Voting on a ` +
  `card removes it from the row immediately -- exactly like voting on a Mapr Travel Picks card, no checkmark stage, it just disappears -- it's an ` +
  `optimistic local update, so it happens instantly and doesn't wait on the write actually landing; only a real failure brings the card back, with ` +
  `the reason shown in a loud red banner above the deck (not on the card, since it's already gone). Once all 3 are rated, the same 3 landmarks come ` +
  `back for a second question -- guess what your partner will say about each one -- behind a big, colorful, animated banner ("Your turn to guess!") ` +
  `so it reads as a clearly new step rather than the same 3 cards repeating themselves. Voting on a guess removes that card the same way. Once ` +
  `you've guessed all 3, the carousel is replaced by a "Today's results" list showing ` +
  `both people's rating and whether your guess was right, once your partner's answer is in too (a lighter version of the spec's "Reveal" screen, ` +
  `without the celebration animation or bonus points). Once you've done all 3, and your partner has too, the day counts. The header flame shows the ` +
  `pair's current count and a live countdown to that day's deadline, turning red once your own side isn't done. The deck always skips anywhere ` +
  `either of you has really (physically) checked into -- picking is for discovering and rating places together, not re-rating somewhere you've ` +
  `been. Once every rateable landmark in that city is checked into by one of you, it falls back to repeats rather than showing nothing.\n` +
  `- Shared freezes: 2 per pair per month, resetting the 1st. Either person can spend one (a button on the streak's detail page) to hold that day -- ` +
  `it keeps the chain from breaking if neither of you finishes today's 3 cards, but it doesn't add a day on its own.\n` +
  `- Recovery mission: opens for 24 hours after a real break that happens with no freezes left. Check in at the same landmark within 30 minutes of ` +
  `each other (or, long-distance, each check in anywhere in the 24 hours) to get the streak back to what it was before the break plus any days you've completed since. Once per pair per month. This is ` +
  `detected reactively (whenever either of you next opens the app), not pushed the instant it happens -- there's no scheduled server job for that yet.\n` +
  `- Compatibility score: shown on a streak's detail page once you and that friend have real ratings for at least 10 of the same landmarks -- a ` +
  `weighted match rate across your most recent 50 shared ratings (exact match counts full, "Ok" against either extreme counts half, ` +
  `opposite extremes count zero). There's no single rolled-up "guess accuracy" number yet -- each card's own reveal already shows right/wrong per ` +
  `landmark, just not summarized into one score.\n` +
  `- Streak partner push notification: the moment you finish rating and guessing all 3 for the day, your streak partner gets a push notification ` +
  `(their device, iOS included, if they've turned push on in Settings) that you're done, with your compatibility score in the body if you two have ` +
  `one yet ("your compatibility: 82% match") or a plain "your turn!" nudge if you don't. Sent once per person per day, from the same server call ` +
  `that checks whether the day closes.\n` +
  `- Not built yet for Dual Streaks: squads (3+ people), and the fuller Reveal screen (match highlights, bonus points for a correct guess). The ` +
  `3-Day/7-Day/30-Day Streak badges in the catalog are earned against a separately-computed solo streak count (from real check-in/rating history), ` +
  `not the dual streak's, and not the same stored count shown in the header/Your Streaks -- the two can drift apart slightly once someone starts ` +
  `using a freeze, since a frozen day still counts as unbroken for the stored streak but not for the badge count.\n` +
  `- Map category filter: tap the 🗂️ button on the Map, then the "All landmarks" dropdown, to search categories and tap to show or hide them.\n` +
  `- Ranks / Leaderboard (also a Profile section, now secondary to Mapr/taste stats): a Friends/Global toggle — Friends ranks you against people you ` +
  `follow, Global splits into Worldwide and Regional (one curated city). Each has Weekly/Monthly/Yearly views. People on the same points share a rank (a tie never shows one of them a worse number), ` +
  `and on the Worldwide board (which lists the top 50) someone ranked below that sees their own points with a "50+" rank instead of "no points yet".\n` +
  `- Streak warning banner: once 5 hours remain in the local day with the solo streak neither secured nor held by a freeze, a red countdown banner shows ` +
  `on every screen (tap it for the Streaks page); using the day's freeze or rating the day's 3 landmarks clears it. A "streak expires" notification in ` +
  `Notifications opens the Streaks page when tapped.\n` +
  `- Trip data (itineraries, My Preferences chips) is stored on the device. Signing out keeps it (it's yours when you sign back in); signing in as a different account clears it so the next ` +
  `person on the same phone doesn't see the previous account's itineraries.\n` +
  `- Inviting friends: Profile has an "Invite Friends" button that shares your username/link; once someone signs up through it AND verifies their email, both of you get 50 ` +
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
  `"Next: …" for the following stop. "All stops in Google Maps" opens the whole route, every stop in order, in Google Maps; Google takes 10 stops per link, so a longer route shows ` +
  `"Google Maps, part 1 of 2" style links to open one after another.\n` +
  `- Each stop on an itinerary or group trip shows its street address under its name.\n` +
  `- Group Trips: a shared itinerary a few friends can all see and edit together (only the trip's owner can change who's a member). ` +
  `"🗺️ View in Map" next to Your Route opens the Map with the trip's stops numbered in the most efficient order from where ` +
  `you are, the route drawn between them, and ▶ Start for live navigation through them (plus "All stops in Google Maps").\n` +
  `- Adding a landmark that's missing (Add Landmark screen): any signed-in account with a verified email can submit one (verify it from the ` +
  `link emailed at sign-up; Settings can resend it). It shows up on the map for everyone right away. If you're standing within about 30 m of the pin when you add it, the check-in prompt opens straight away with the usual rating questions for that kind of place (e.g. "Do you like Peruvian food?"). While typing the name or address, ` +
  `it warns you if that spot looks like it's already on the map (with a link to view the existing one). A typed-name guess is just a heads-up -- ` +
  `dismissible with "This is a different place" since the name match can be a false positive. Picking an existing landmark directly out of the ` +
  `address search's own suggestions is different -- that can't be a false positive, so there's no "different place" option for it and submitting ` +
  `is blocked until you either view the existing one or change what you typed/picked. A landmark added more than ~100 km from any curated ` +
  `city shows as a "Custom pin" with no city: you can check in, rate and view it, but it has no "Add to Itinerary" button since there's no ` +
  `city itinerary for it. Landmarks added inside a curated city do show up in that city's itinerary when added. Photos are shrunk before upload.\n` +
  `- You can also add one through Mapr just by saying "make a landmark for where I am" (or "add this place", "create a landmark here"). ` +
  `Mapr looks up the real place at your exact GPS location and asks "Just to confirm -- you're at [name], right?" before creating ` +
  `anything; say no and name the actual place ("no, I'm at the visitor center") and it looks that up instead and asks again. Needs ` +
  `location on and the same signed-in, verified-email account as Add Landmark.\n` +
  `- "Nearby Now" (on the map screen): an expandable panel showing landmarks close to your current location right now.\n` +
  `- Photos: up to 3 can be added when you rate or check in; once checked in, a landmark's page also has an "Add photo" gallery of its own (up to 9 per check-in), separate from the rating's 3. Big phone photos are shrunk automatically before upload; only a photo that is still over 8 MB afterwards is refused, with a message. A rating holds at most 3 photos in total (new ones add to the ones already on it). Adding a photo never replaces your earlier ones. If you added a landmark yourself, you can delete it from its own page ("Delete this landmark", with a confirmation) as well as from its map pin; it also leaves your itinerary. And re-checking in at a place you already rated pre-fills your saved rating and comment. On a landmark's page, the "Rate your visit" card shows once you've checked in OR already rated it through Rate a Landmark (so those ratings can be edited there too), and a saved rating has a "Remove my rating" button (asks to confirm; removes the rating, its comment and its rating photos, keeps the check-in). If a photo fails to upload after saving, adding it again re-enables the save button.\n` +
  `- Photos for places without one: a landmark with no photo of its own shows a colored category tile at first; when the tile scrolls into view (and you're signed in and online) the app tries to load a real photo of that exact place from Google Maps, shown with a small "Photo: <name> via Google Maps" credit (a tiny © badge on small thumbnails; tap it to see the credit). The same lookup runs when a landmark's own stored photo fails to load. If no confident match exists, or it can't load, the colored tile just stays. The photos themselves aren't saved anywhere and can change; your own check-in photos always take priority over them.\n` +
  `- Offline maps: an itinerary's "📥 Offline Map" card has "Download for Offline" (and Re-download), caching that city's map tiles so the map still works without a connection.\n` +
  `- Check-in location: every check-in saves how far you were from the place and your GPS accuracy at that moment (rating-only claims from Rate a Landmark are not check-ins and save neither). Today a check-in works from anywhere and is marked unverified; the app has a switch for a "you must be within 30 m" rule (bigger places such as parks keep their own larger radius) but it is currently OFF.\n` +
  `- Everyday Miami places: besides the hand-picked landmarks, the Miami area (the airport to Pinecrest, Doral to Key Biscayne and Miami Beach) has places imported from OpenStreetMap, added one category at a time. They are real map pins like any landmark: you can check in, rate them, add them to an itinerary, and Mapr picks from them. Their facts come only from OpenStreetMap and Wikidata (cuisine, opening year, outdoor seating and the like), so some have none, and their page says "Place data © OpenStreetMap contributors" with a link to the place on OpenStreetMap. A few have a stored Wikimedia Commons photo; the rest look up a Google Maps photo when you open the place (not while scrolling a list) or show the colored category tile. They load a moment after the app opens, so right at launch the Miami map can briefly show only the hand-picked landmarks. If an imported place's details are wrong, it can be fixed on OpenStreetMap.\n` +
  `- Offline: with no signal, check-ins, ratings, photo uploads and anything that needs the server fail fast with an "You're offline" message and keep what you typed. Simple changes (friend requests, settings toggles, blocks, replies, adding a landmark) are saved on the device with a "Saved on this device" notice and sync automatically when you're back online.\n` +
  `- Habit tracking (on by default, toggle in Settings): while the app is open, Mapr notices places you keep actually visiting -- three or more different days at the same spot -- and, next time you're standing there, asks "You keep going here, want to add it to an itinerary?" with options to add it, say it's already there, snooze it, or stop tracking that spot. It also checks whether something matching your taste (an interest, or what you've told Mapr you love) is worth a stop near there or on the way -- e.g. spotting a shooting range nearby if you love shooting -- and offers to add that too, only when it has a genuinely good match. Entirely on-device: raw location history never leaves your phone, only the one place name it resolves once a spot has become a real pattern, plus that one taste-match question sent the same way a normal Mapr chat message is. It only notices patterns while the app is open (there's no real background location or push notification support), and it also drops a note in your in-app Notifications.\n` +
  `- Settings: switch dark/light mode, set units to Automatic (by your location/region), Imperial (mi/ft) or Metric (km/m), toggle your profile between public (reviews/photos ` +
  `visible to everyone) and private (friends only), set a home address (used for taste learning), edit the taste baseline described above, change your ` +
  `password (for email/password accounts), and (at the very bottom) Request a Feature, Report a Bug, Privacy Policy & Terms of Service, and the date ` +
  `you joined. All account-level actions live in Settings now, not on Profile. Delete Account (very bottom of Settings, a red button): permanently deletes your account. You type DELETE and re-enter your password (Google-only accounts re-confirm with a Google popup instead); it then erases your profile, username, reviews and photos, friend requests/friends/blocks, streaks, picks feedback, notifications, Mapr chats and projects you own, group trips you own (and removes you from ones you joined), landmarks you submitted, and your saved preferences, then signs you out. Check-ins stay on the leaderboard for scoring integrity but are stripped of your name, photos and the saved distance and GPS accuracy. It cannot be undone.\n` +
  `- Report a Bug (Settings, right below Request a Feature): a signed-in user describes what's broken (a required title + description, plus optional ` +
  `steps to reproduce) and submits it. The one admin account gets an in-app notification for each new report, and tapping it opens the same screen's ` +
  `second tab (Resolve/Dismiss Reports) -- same admin-review shape as Request a Feature's Approve/Reject tab, just with its own separate collection, ` +
  `so bug reports and feature requests never mix in the same queue.\n` +
  `- Sign in options: you can create an account and sign in with an email and password, or use Google Sign-In. Google Sign-In uses your Google account ` +
  `for authentication and doesn't require a separate password here.\n\n`;
