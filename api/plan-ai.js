import Anthropic from '@anthropic-ai/sdk';
import { ALL_LANDMARKS, getRegion } from '../src/data/regions.js';
import { guardAiRequest } from './_lib/aiGuard.js';
import { APP_HELP } from './_lib/appHelp.js';
import { TIME_SLOTS, WEEKEND_NIGHT_BOOSTS, timeSlotFor } from '../src/lib/tagScores.js';
import { withCors } from './_lib/cors.js';
import { chatRanking, CHAT_NEAR_KM } from './_lib/maprChatRanking.js';
import { loadServerModels } from './_lib/maprServerModels.js';
import { ensureServerPlacePacks } from './_lib/placePacks.js';
import { factsField } from './_lib/placeFacts.js';
import { asksForDirections, directionsTarget, placesNamedIn } from '../src/lib/placeMatch.js';
import { PLAN_AI_MODEL } from './_lib/aiModels.js';
import { logAiCall } from './_lib/aiCallLog.js';
import { AI_LONG_TIMEOUT_MS, aiFailure } from './_lib/upstream.js';

// Backs the Mapr tab's chat interface -- the app's home screen, the one
// thing people open every day -- a real back-and-forth instead of a
// one-shot form. The client sends the whole conversation so far (its own
// typed turns, plus each of the AI's previous replies), plus the same
// rating history and saved interests Mapr Picks reads, and gets one more
// assistant turn back: a short conversational reply, plus 0-4 real stops.
// Stops can come from our own curated catalog (open inside the app, full
// details, check-ins) OR, via the web_search tool below, from anywhere on the
// live web -- a city we don't track, a niche vibe (nightlife, racing, live
// music) our catalog doesn't model, or anything current -- so a request is
// never limited to just the landmarks we happen to have data for.
const INSTRUCTIONS =
  `You are the AI trip-planning chat inside the app "Landmark Hunters" -- the app's home screen, the first thing a ` +
  `traveler opens. You talk like a sharp, upbeat concierge -- short, natural sentences, no corporate fluff. You have ` +
  `a curated catalog of real landmarks (below, one per line as "region/id | name | short description"), a live ` +
  `web_search tool for anything the catalog doesn't cover, and -- when the traveler has rated or checked into ` +
  `anything before -- their own rating history and saved interests. A traveler is chatting with you about what they ` +
  `want to do. Reply to their latest message given the conversation so far.\n\n` +
  `Rules:\n` +
  `- Keep "reply" EXTREMELY short by default, always: 1-2 short sentences, about 30 words at most, plain text only (no bold, no bullets, no numbered lists, no headings, no emoji lists). Give the single best answer, not every tip. Never end with a menu of offers; at most one short follow-up question. Never a paragraph. ` +
  `No throat-clearing, no restating their question, no listing every possible caveat. This applies to EVERY kind of ` +
  `reply -- recommending stops, answering a question about the app or a place, telling them about their own taste, ` +
  `just chatting. Only go longer when they explicitly ask for it ("tell me more", "explain", "give me details", "what ` +
  `else should I know", asking a genuinely multi-part question) -- then answer fully, but still no filler.\n` +
  `- If a TRAVELER PROFILE is given below, you actually know this person -- use it to personalize suggestions ` +
  `(same trait/category reasoning as Mapr Picks: weigh what they said in their own words and the reasons behind a ` +
  `rating over the bare category, and never suggest a specific kind of place -- a zoo, a cemetery, a private club, ` +
  `whatever it is -- they've clearly told you they skip). If they ask what you know about them or their interests, ` +
  `answer directly and specifically from the profile -- name actual places and reasons, don't hedge or deflect to ` +
  `a generic question when you genuinely have this data. If no profile is given (or it's empty), say plainly that ` +
  `you don't have a rating history for them yet rather than pretending otherwise, and ask what they're into.\n` +
  `- The IN THEIR OWN WORDS section (if present) is a general BASELINE the traveler set once -- broad likes and ` +
  `dislikes by category. Actual rating history is more precise and specific (a real place, a real reason), so when ` +
  `the two would point different directions on the same thing, trust the specific rating over the general baseline. ` +
  `Use the baseline to cover categories no rating has touched yet, not to override a specific one.\n` +
  `- If that baseline states a city-specific exception ("I don't usually like museums, but in Paris show me more"), ` +
  `follow it only when the city you're planning for right now (from CURRENT LOCATION, the city they're asking about, ` +
  `or an itinerary's city) matches the one they named -- even if it contradicts their general baseline or ratings ` +
  `from other cities. An exception named for a different city never applies here.\n` +
  `- A city can have its own specialty independent of someone's general taste -- Rome means architecture and ancient ` +
  `ruins, Paris means art museums, Tokyo means street food, whatever the city is actually known for. If the traveler ` +
  `has NO strong signal either way in that category (no rating, no stated love or dislike, general or city-specific) ` +
  `and CURRENT LOCATION or the city they're asking about is one of these, it's fine to ask once, in plain words with ` +
  `quickReplies ("Since you're in Rome, want some architecture and ancient ruins picks?" -> ["Yes, show me some", ` +
  `"No thanks"]) instead of silently deciding either way. Ask this at most once per city per conversation. Never for a ` +
  `category they've explicitly told you (generally or for this specific city) they dislike -- that's still off-limits, ` +
  `city specialty or not.\n` +
  `- Loving something is not the same as wanting it RIGHT NOW -- someone can genuinely love hiking and scenic ` +
  `views and still want a club, not a trail, on a Saturday night in the city. Read their CURRENT message for time, ` +
  `day, mood, and occasion cues (tonight, this weekend, "something chill", "we're getting dressed up") and weigh ` +
  `those over a static profile match -- their taste tells you the MENU of things they enjoy, their actual message ` +
  `tells you which item off that menu fits right now. Don't default to their single most-loved category regardless ` +
  `of context.\n` +
  `- Prefer the catalog when it has a genuinely good fit -- those stops open inside the app with full details and check-ins.\n` +
  `- Use web_search whenever the catalog doesn't cover what they're asking -- a city or neighborhood we don't track, a specific vibe (nightlife, racing, shopping, live music), or anything current -- so you're never limited to just the catalog.\n` +
  `- If you already have enough to go on (a vibe, a time budget, an interest, or a rating history to lean on -- doesn't need to be much), recommend 2-4 real stops in a sensible order, mixing catalog and web-found places as needed, with one short reason each tied to what they said or to their known taste.\n` +
  `- "Near me" asks. With a kind of place ("arepas near me", "parks nearby", "a bar close to me"): return the best matches for exactly that kind, preferring the ones closest to their CURRENT LOCATION (a great match a few minutes away beats a slightly better one across town); the app lists them closest first and lets them re-sort by rating. With no kind of place at all ("landmarks near me", "what's near me", "anything around here") and no kind given earlier in this chat: don't guess -- ask ONE short question, "What kind of place are you looking for?", and fill "quickReplies" with 3-4 kinds that exist near them (e.g. "Food", "Parks", "History", "Nightlife"). If they already said a kind earlier in the chat, use it instead of asking. This rule wins over the rating-history rule below.\n` +
  `- If their ask is too vague to suggest anything useful yet AND you have no rating history to lean on either, ask ONE short clarifying question instead of guessing -- but don't stall forever; after any clarification, go ahead and suggest something. With a rating history, a vague ask ("something fun today") is enough to go on -- use their taste instead of asking them to repeat it.\n` +
  `- Repeat check-ins are a real, encouraged feature here (see the app's own rules), so it's fine to bring back a spot they've already loved alongside something new -- if it's genuinely unclear which they want, ask in plain words, never a bare "new or repeat?" fragment: something like "Want me to stick to places you haven't been, or is it fine to bring back a favorite too?"\n` +
  `- Whenever you ask a clarifying question that has a small set of short, natural answers (new vs. a repeat favorite, indoor vs. outdoor, morning vs. evening, etc.), ALSO fill "quickReplies" with 2-4 of those answers verbatim, each just a few words, in the exact words a traveler would tap rather than type -- the app shows these as tappable buttons under your message. Leave "quickReplies" empty whenever you're not asking that kind of question (recommending stops, just chatting, an open-ended "what are you into?" with no short-answer shape).\n` +
  `- If they're just chatting (thanks, small talk, a question about a place you already suggested, or a question about their own taste/interests), reply naturally with no stops.\n` +
  `- You're also the app's only assistant, so answer anything else they ask: history, tips, what to see or eat, or the ` +
  `best time to go for a landmark or city (say that hours/prices may vary), or which landmark they mean from a vague ` +
  `description or nickname (return it as a catalog stop so they can open it). If they ask when a place opens/closes, ` +
  `answer with just TODAY's hours (from LOCAL NOW below) via web_search if you don't already know them -- never dump ` +
  `the full week's schedule unless they specifically ask for the full hours or a different day. For "how do I..." / ` +
  `"what is..." questions about the app itself, answer from HOW LANDMARK HUNTERS WORKS below as ground truth -- never invent a ` +
  `feature it doesn't list. Keep these short too by default (see the brevity rule above) -- only go longer when they ask ` +
  `for more detail or the question is genuinely multi-part.\n` +
  `- Plan for the time the stops are FOR, not the time they're asking. Work that out from their message ("tonight", ` +
  `"Saturday night", "lunch tomorrow", a time they name); only if they don't say, assume RIGHT NOW. At that planned ` +
  `time, favor the categories the TIME SLOTS table lists for it, on top of their TAG SCORES. Never favor a category ` +
  `they score negative just because it fits the time.\n` +
  `- If CURRENT LOCATION is given below, that's where the traveler is right now (from their phone's GPS). Use it for ` +
  `"near me", "nearby", "around here", "close by" and for any ask with no city -- search near that town, prefer places a ` +
  `short trip away, and mention roughly how far each stop is. Never ask which city they're in when you have it. If ` +
  `location is marked unavailable and they ask for something nearby, ask which city or neighborhood they're in.\n` +
  `- If they ask you to add/make/create a landmark for where they physically are right now ("make a landmark for where I ` +
  `am", "add this place", "create a landmark here"), use the create_landmark_here action (see JSON shape below) -- never ` +
  `guess the place's name yourself even with CURRENT LOCATION given, since that's just a rough GPS point, not a business; ` +
  `the app looks up the exact real place at their coordinates and asks them to confirm before creating anything ("Just to ` +
  `confirm -- you're at Wynwood Walls, right?"). Only set "nameOverride" on this action when THEY named the specific place ` +
  `themselves (in the same message, or correcting a wrong guess afterward with "no, I'm at ___") -- otherwise leave it out ` +
  `and let the app's own location lookup find it. If they haven't given a location and CURRENT LOCATION is unavailable, ` +
  `tell them to turn location on instead of using this action.\n` +
  `- You can also DO things with their itineraries when they ask, via "actions" (see the JSON shape below): add a stop ` +
  `("add it to my itinerary", "put Autana on my Philly trip"), remove one, create a new itinerary, rename one, or add a ` +
  `person by username. Only act when they clearly ask -- never on your own. "it"/"that one"/"both" refer to places you ` +
  `suggested earlier in this chat; use their exact names. Pick the itinerary from YOUR ITINERARIES below by its ref: the ` +
  `one they name, else the one in that stop's city. NEVER create an itinerary they didn't ask for: only use "new" or ` +
  `create_itinerary when they explicitly asked to make/start/create one. If they ask to add a stop and have no itinerary in ` +
  `that city, don't act -- ask whether to start one ("You don't have a Miami itinerary yet -- want me to start one?") with ` +
  `quickReplies like "Yes, start one" / "No thanks". Even then, the app asks them to confirm before anything is created. ` +
  `If it's genuinely unclear which of several itineraries they mean, ask instead, with their names as quickReplies. In ` +
  `"reply", say what you're doing in plain words ("Added Autana to your Philly itinerary."); the app confirms each ` +
  `action under your message. Checking in, rating, and account settings are not actions -- tell them where to tap.\n` +
  `- If they ask how to get to, for directions to, or where a specific place is ("How do I get to Hillstone?"), return ` +
  `that one place as a stop (its catalog or MATCHING PLACES region/id when it has one, else a web stop with the address ` +
  `you find via web_search), even if you ` +
  `suggested it earlier. Keep "reply" to one short line that points them to the card's Directions button ("Here's ` +
  `Hillstone -- tap Directions to get there."), and never write out turn-by-turn directions yourself.\n` +
  `- When they push back or ask to adjust ("more nightlife", "skip the museum", "somewhere closer"), revise the picks accordingly.\n` +
  `- If they say they just left, just finished at, or are leaving a specific place ("I just left the shooting range, want to ` +
  `go somewhere for dinner", "done at Autana, what next?"), set "rate" to that place so the app can ask them how it was -- and ` +
  `open your "reply" by asking in plain words ("How was the range -- love it, okay, or not for you?") before answering the rest ` +
  `of their message as usual. Use its catalog region/id as "match" when it's in the catalog or NEAREST CATALOG LANDMARKS, ` +
  `otherwise its real name plus any address you know. Only when they clearly say they were there -- never guess, and not for a ` +
  `place they merely mention or plan to visit. If they already said how it was, still set "rate" (the app lets them save it).\n` +
  `- They can rate right in this chat with the pick buttons on a place's card ("I'd go" / "Not sure" / "Not for me"), which teach Mapr their taste. If they ask to rate, or say they want to rate or are at a place ("can I rate here?", "rate Hillstone"), return that place as a stop (for "here" or "this place", the first NEAREST CATALOG LANDMARK when it is under 0.3 km, else ask which place) so its card shows the buttons. If they ask to rate without naming a place and you are not at one, return NO stops and a one-line reply: the app then shows a carousel of places they have not rated yet. Say yes in one short line ("Sure -- tap how it sounds."); never tell them to go to the landmark's page. Leave "rate" for the "I just left X" case above.\n` +
  `- Never write a street address in "reply". When they ask where a place is or for its address, return that place as a stop and write {{address:N}} where the address would go (N = its position in "stops", starting at 1), e.g. "Sure, here's the {{address:1}}." The app shows it as a link that opens maps. Also no "about 0.5 km away" in the reply: the card shows the distance.\n` +
  `- Never invent a place. Catalog stops must be real region/id values from the catalog below. Web-found stops must be real places you actually found via search, and must include the source URL.\n\n` +
  `Once you're done -- searching or not -- your ENTIRE visible reply must be ONLY a single JSON object. No narration before or after it, not even a note that you're searching:\n` +
  `{"reply": "<your conversational reply, short by default -- 1-2 sentences unless they asked for more>", "stops": [<catalog stop> | <web stop>, ...], "quickReplies": [<short tappable answer>, ...], "actions": [<action>, ...], "rate": null | {"match": "<region/id>"} | {"name": "<real place name>", "address": "<address or empty>"}}\n` +
  `- Catalog stop: {"match": "<region/id from the catalog>", "reason": "<why this stop, 1 short sentence>"}\n` +
  `- Web stop: {"name": "<real place name>", "place": "<city or neighborhood>", "address": "<street address if your search showed one, else empty>", "url": "<source URL you found it from>", "rating": <the public star rating out of 5 your search showed, e.g. 4.6, else null>, "reason": "<why this stop, 1 short sentence>"}\n` +
  `- "stops" can be an empty array. Only use region/id values that actually appear in the catalog -- for anything else, use the web stop shape instead of inventing a match id.\n` +
  `- "quickReplies" can be an empty array -- see the rule above for when to fill it in.\n` +
  `- "actions" is usually an empty array. Each action is one of:\n` +
  `  {"type": "add_stop", "stop": "<region/id, or the exact name of a place from this chat>", "itinerary": "<ref from YOUR ITINERARIES, or \"new\">", "newName": "<optional name if new>"}\n` +
  `  {"type": "remove_stop", "stop": "<name or region/id>", "itinerary": "<ref>"}\n` +
  `  {"type": "create_itinerary", "name": "<name>", "city": "<region id from the catalog, e.g. miami>", "group": <true for a group itinerary, else false>}\n` +
  `  {"type": "rename_itinerary", "itinerary": "<ref>", "name": "<new name>"}\n` +
  `  {"type": "create_landmark_here", "nameOverride": "<only if they named the specific place themselves, else omit>"}\n` +
  `  {"type": "add_member", "itinerary": "<ref>", "username": "<their username, no @>"}`;

// PLAN_AI_MODEL (claude-haiku-4-5) per-token pricing (USD per token, i.e. price-per-MTok / 1e6),
// plus $10/1,000 web searches -- used to report a running cost estimate to the
// client. Update these if the model or its pricing changes.
const PRICE_PER_TOKEN = {
  input: 1 / 1_000_000,
  output: 5 / 1_000_000,
  // cache_control below doesn't set a ttl, so writes default to the 5-minute tier.
  cacheWrite: 1.25 / 1_000_000,
  cacheRead: 0.1 / 1_000_000,
};
const PRICE_PER_SEARCH = 10 / 1000;
const str = (v, n) => String(v ?? '').trim().slice(0, n);

// Straight-line distance in km (haversine).
function kmBetween(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// A catalog (or imported) landmark as a chat stop card. lat/lng ride along so
// the card can show distance before the client has loaded the place packs.
function catalogStop(landmark, reason) {
  return {
    region: landmark.regionId,
    id: landmark.id,
    name: landmark.name,
    images: landmark.images || [],
    categories: landmark.categories,
    ...(Number.isFinite(landmark.lat) && Number.isFinite(landmark.lng) ? { lat: landmark.lat, lng: landmark.lng } : {}),
    ...(landmark.source === 'osm' ? { source: 'osm' } : {}),
    reason: String(reason || '').slice(0, 200),
  };
}

function estimateCostUsd(usage) {
  if (!usage) return 0;
  const tokenCost =
    (usage.input_tokens || 0) * PRICE_PER_TOKEN.input +
    (usage.output_tokens || 0) * PRICE_PER_TOKEN.output +
    (usage.cache_creation_input_tokens || 0) * PRICE_PER_TOKEN.cacheWrite +
    (usage.cache_read_input_tokens || 0) * PRICE_PER_TOKEN.cacheRead;
  const searchCost = (usage.server_tool_use?.web_search_requests || 0) * PRICE_PER_SEARCH;
  return tokenCost + searchCost;
}

// The last few usable turns, starting on a user turn: the Messages API
// rejects a conversation whose first message is the assistant's, and
// slice(-10) of an alternating chat that ends on the user's turn lands
// exactly there -- so once a Mapr chat got ~10 messages long, every further
// message failed with "AI request failed".
export function trimTurns(incoming) {
  const turns = (Array.isArray(incoming) ? incoming : [])
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 800) }));
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

// Who the request is for. Asked in the app before every request: 'solo' (just
// the traveler) or 'group'. Only 'group' is special; anything else is solo.
// Mapr answers stay short unless the traveler asks for more. The prompt says so;
// this enforces it when the model runs long anyway: no markdown, first two
// sentences, 260 characters. Asking to "explain", "tell me more", "details" etc.
// lifts the cap.
export const ASKS_FOR_LONGER = /\b(tell me more|more (detail|info|about)|details?|explain|elaborate|in depth|in detail|step[- ]by[- ]step|longer|full (list|hours|schedule)|everything)\b/i;
// Sentence split that doesn't cut at "St.", "Dr." or "e.g.", nor at "a.m." /
// "p.m." when the sentence goes on ("9 a.m. to 5 p.m. daily").
const TITLE_ABBR = /(?:^|\s)(?:St|Ave|Dr|Mt|Rd|Blvd|Ln|Ct|Pl|Hwy|Mr|Mrs|Ms|Jr|Sr|vs|No|e\.g|i\.e|approx|est)\.$/i;
const TIME_ABBR = /(?:^|\s)[ap]\.m\.$/i;
function splitSentences(text) {
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (prev && (TITLE_ABBR.test(prev) || (TIME_ABBR.test(prev) && /^[a-z0-9]/.test(part)))) out[out.length - 1] = `${prev} ${part}`;
    else out.push(part);
  }
  return out;
}
export function conciseReply(reply, userText = '') {
  const plain = String(reply || '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/gm, '')
    .trim();
  if (ASKS_FOR_LONGER.test(String(userText))) return plain;
  const sentences = splitSentences(plain);
  let out = sentences.slice(0, 2).join(' ');
  if (out.length > 260) out = sentences[0].length <= 260 ? sentences[0] : `${out.slice(0, 257).trimEnd()}...`;
  return out || plain;
}

// Street addresses never appear in a reply as text: each one becomes an
// {{address:N}} token (N = the 1-based stop it belongs to) or, for an address
// with no matching stop, {{addressq:<text>}}. The app shows the word
// "address" as a link that opens Open in Map / Google Maps / Apple Maps.
// The house number can't be a count ("10 Blocks Down Main St"); a direction
// after the street type ("Ave NW") and the city, state and ZIP stay in the
// match. A city is 1-3 capitalized words, never a 2-letter state.
const STREET = /\b\d{1,6}\s+(?!(?:[Bb]locks?|[Mm]inutes?|[Mm]ins?|[Mm]iles?|[Hh]ours?|[Ss]teps?|[Ss]tops?|[Ff]eet|[Mm]eters?)\b)(?:[NSEW]\.?\s+|(?:North|South|East|West)\s+)?(?:[A-Z0-9][\w'.-]*\s+){1,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Way|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Hwy|Highway|Pkwy|Parkway|Ter|Terrace|Cir|Circle|Sq|Square|Pike|Trail)\b(?:\s+[NS][EW]\b)?(?:,?\s*(?:Suite|Ste|Unit|#)\s*\w+)?(?:,\s*(?![A-Z]{2}\b)[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,2}){0,2}(?:,\s*[A-Z]{2}(?:\s+\d{5})?)?/g;
export function linkAddresses(reply, stops = []) {
  let out = String(reply || '');
  stops.forEach((st, i) => {
    const addr = String(st?.address || '').trim();
    if (!addr) return;
    for (const piece of [addr, addr.split(',')[0]]) {
      if (piece.length >= 6 && out.includes(piece)) out = out.split(piece).join(`{{address:${i + 1}}}`);
    }
  });
  out = out.replace(STREET, (m) => `{{addressq:${encodeURIComponent(m.trim())}}}`);
  return out.replace(/(\{\{address:\d+\}\})(?:[,\s]*\{\{address:\d+\}\})+/g, '$1');
}

// "can i rate here", "rate this place": a request to rate wherever they are.
// "rate" must be the verb ("I rate", "to rate", "Rate this"), so "what's the
// crime rate here?" or "a first-rate spot" isn't read as an ask to rate.
const RATE_VERB = String.raw`(?:^|[.!?,]\s*|\b(?:i|me|to|we|you|u|us|let's|lets|please|pls|wanna|gonna|lemme|and|then)\s+)rate\b`;
const RATE_HERE = new RegExp(`${RATE_VERB}[^.?!]{0,30}\\b(here|this (place|spot|one)|where i am)\\b`, 'i');
const RATE_ANY = new RegExp(
  `\\b(can|could|let|want|wanna|like|how do|how can)\\b[^.?!]{0,25}${RATE_VERB}|(?:^|[^-\\w])rate (some|a few|more|places|landmarks|stuff)\\b|\\bplaces? to rate\\b`,
  'i'
);
export const asksToRateHere = (text) => RATE_HERE.test(String(text || '').trim());

// Any ask to rate, not tied to one named place ("can I rate?", "let me rate
// some places", "places to rate"). Together with asksToRateHere, and when Mapr
// has no single place to show, the app puts up a carousel of places they have
// not rated yet.
export const asksToRate = (text) =>
  asksToRateHere(text) || RATE_ANY.test(String(text || '').trim());

export const requestForOf = (body) => (body?.requestFor === 'group' ? 'group' : 'solo');

// The traveler's own taste, as sent by the client. For a GROUP request none of
// it is used -- even if a client sent it -- so places are chosen from what was
// asked for, not from the traveler's usual taste (their rating history, saved
// interests, intro, tag scores or Insider Mode).
export function tasteInputsOf(body) {
  if (requestForOf(body) === 'group') {
    return { reviews: [], interests: [], tasteIntro: '', insiderMode: false, tagScoreSummary: {} };
  }
  return {
    reviews: body?.reviews,
    interests: body?.interests,
    tasteIntro: body?.tasteIntro,
    insiderMode: body?.insiderMode === true,
    tagScoreSummary: body?.tagScoreSummary,
  };
}

export const GROUP_REQUEST_TEXT =
  'GROUP REQUEST: this request is for a group, not just the traveler. Follow exactly what they asked for ' +
  '(for example "family bowling" means bowling places a family can go to). Do NOT use the traveler\'s own taste, ' +
  'ratings, past picks, saved interests or "usual" favorites to choose places, and never say you are picking ' +
  'something because they usually like it. If no taste information is given below, that is on purpose: do not ' +
  'ask about their taste or say you lack a rating history. If the ask is too vague to suggest anything, ask ONE short ' +
  'question about what the group wants to do.';

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel.' });
    return;
  }
  // A tight limit -- web_search makes each call more expensive.
  const account = await guardAiRequest(req, res, { key: 'plan-ai', limit: 10, windowMs: 10 * 60 * 1000 });
  if (!account) return;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const incoming = Array.isArray(body.messages) ? body.messages : [];
    // Keep the payload (and cost) bounded -- a handful of recent turns is
    // plenty of context for a trip-planning chat.
    const turns = trimTurns(incoming);

    if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
      res.status(400).json({ error: 'Say something to start planning.' });
      return;
    }

    // Multiple cities at once (e.g. "Philly or NYC this weekend") -- accepts
    // the new regionIds array, plus the old singular regionId for anything
    // that hasn't been updated to send the array.
    const regionIds = [
      ...(Array.isArray(body.regionIds) ? body.regionIds : []),
      ...(body.regionId ? [body.regionId] : []),
    ]
      .map((id) => String(id).slice(0, 40))
      .filter(Boolean);
    const uniqueRegionIds = [...new Set(regionIds)];
    const regions = uniqueRegionIds.map((id) => getRegion(id)).filter(Boolean);
    // The imported everyday places (public/places) join ALL_LANDMARKS here.
    // They stay out of the cached CATALOG block (over a thousand cafes and
    // parks would multiply its size); MATCHING PLACES below lists the ones a
    // message names.
    await ensureServerPlacePacks();
    const curated = ALL_LANDMARKS.filter((l) => l.source !== 'osm');
    const pool = regions.length ? curated.filter((l) => uniqueRegionIds.includes(l.regionId)) : curated;

    const validIds = new Set(pool.map((l) => `${l.regionId}/${l.id}`));
    const catalog =
      (regions.length
        ? `The traveler wants stops in ${regions.map((r) => r.name).join(' or ')} only.\n\n`
        : 'The traveler has not picked a city, so any city is fair game.\n\n') +
      'CATALOG (region/id | name | category | description):\n' +
      pool
        .map((l) => `${l.regionId}/${l.id} | ${l.name} | ${l.categories?.[0] || ''} | ${(l.summary || '').slice(0, 140)}`)
        .join('\n');

    // Same rating history Mapr Picks reads -- this is the app's home
    // screen now, so it should never have to say "I don't know you" when
    // the traveler has clearly already told the app what they like.
    const requestFor = requestForOf(body);
    const taste = tasteInputsOf(body);
    const reviews = (Array.isArray(taste.reviews) ? taste.reviews : []).slice(0, 60).map((r) => ({
      name: str(r.name, 80),
      tier: str(r.tier, 30),
      categories: (Array.isArray(r.categories) ? r.categories : []).map((c) => str(c, 30)).slice(0, 3),
      highlights: (Array.isArray(r.highlights) ? r.highlights : []).map((h) => str(h, 40)).slice(0, 3),
      comment: str(r.comment, 280),
    }));
    const interests = (Array.isArray(taste.interests) ? taste.interests : []).map((c) => str(c, 30)).slice(0, 20);
    // Told directly at onboarding or from Settings (the notes step in src/screens/Onboarding.jsx,
    // src/screens/Settings.jsx) -- free-form, in the traveler's own words, not
    // tied to any rating. Read as prose, same as the rest of the profile.
    const tasteIntro = str(taste.tasteIntro, 4000);
    // Insider Mode -- unlocked client-side once Mapr's own predictions are
    // confidently right about this traveler (src/lib/tasteProfile.js). The
    // client decides the unlock and just tells us the flag; this only
    // changes how a request already this personalized gets phrased.
    const insiderMode = taste.insiderMode === true;
    const hasHistory = reviews.length > 0;
    const profileParts = [];
    if (tasteIntro) profileParts.push(`IN THEIR OWN WORDS (told Mapr this directly): "${tasteIntro}"`);
    if (hasHistory) {
      profileParts.push(
        'RATING HISTORY (use it; see the rules on how):\n' +
          reviews
            .map(
              (r) =>
                `- ${r.name} [${r.categories.join(', ') || '?'}]: ${r.tier || 'rated'}` +
                (r.highlights.length ? ` — ${r.highlights.join(', ')}` : '') +
                (r.comment ? ` — "${r.comment}"` : '')
            )
            .join('\n')
      );
    } else if (!tasteIntro && requestFor !== 'group') {
      profileParts.push('RATING HISTORY: none yet.');
    }
    if (interests.length) profileParts.push(`Saved interests: ${interests.join(', ')}`);
    // Category scores learned from ratings (src/lib/tagScores.js), one
    // overall set ("all") or, for older accounts, per city,
    // and the time-slot table for weighing them by when a plan is for.
    const tagLines = Object.entries(taste.tagScoreSummary && typeof taste.tagScoreSummary === 'object' ? taste.tagScoreSummary : {})
      .slice(0, 3)
      .map(([region, tags]) => {
        const parts = Object.entries(tags && typeof tags === 'object' ? tags : {})
          .slice(0, 20)
          .map(([tag, v]) => [str(tag, 30), Math.round(Number(v))])
          .filter(([, v]) => Number.isFinite(v))
          .sort((a, b) => b[1] - a[1])
          .map(([tag, v]) => `${tag} ${v}`);
        return parts.length ? `${str(region, 40)}: ${parts.join(', ')}` : '';
      })
      .filter(Boolean);
    if (tagLines.length) {
      profileParts.push(
        'TAG SCORES (learned from their ratings; "all" is their one overall taste, the same in every city; about -100 to 150, higher = stronger, negative = dislikes):\n' +
          tagLines.join('\n')
      );
    }
    const nowDay = Number(body.localNow?.day);
    const nowHour = Number(body.localNow?.hour);
    if (Number.isInteger(nowDay) && Number.isInteger(nowHour)) {
      const current = timeSlotFor(nowDay, nowHour);
      profileParts.push(
        `RIGHT NOW for the traveler: ${str(body.localNow?.label, 40) || 'unknown'}` +
          (current.slot ? ` (${current.weekendNight ? 'weekend night' : current.slot.label})` : ' (late night)') +
          '.\nTIME SLOTS (category multipliers for the time a plan is for):\n' +
          TIME_SLOTS.map(
            (t) => `- ${t.label}: ${Object.entries(t.boosts).map(([tag, m]) => `${tag} x${m}`).join(', ')}`
          ).join('\n') +
          `\n- Friday/Saturday night instead: ${Object.entries(WEEKEND_NIGHT_BOOSTS)
            .map(([tag, m]) => `${tag} x${m}`)
            .join(', ')}`
      );
    }
    // Live GPS from the traveler's device (Mapr.jsx), with the town it
    // resolves to. Also lists the closest catalog landmarks, so "near me"
    // can land on real in-app stops before reaching for web search.
    let hereLandmark = null;
    const loc = body.location && typeof body.location === 'object' ? body.location : null;
    const locLat = Number(loc?.lat);
    const locLng = Number(loc?.lng);
    if (loc && Number.isFinite(locLat) && Number.isFinite(locLng) && Math.abs(locLat) <= 90 && Math.abs(locLng) <= 180) {
      const label = str(loc.label, 120);
      const acc = Number(loc.accuracy);
      const nearest = curated.filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng))
        .map((l) => ({ l, km: kmBetween(locLat, locLng, l.lat, l.lng) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 8)
        .filter((x) => x.km <= 80);
      if (nearest[0] && nearest[0].km < 0.3) hereLandmark = nearest[0].l;
      profileParts.push(
        `CURRENT LOCATION: ${label || 'unknown town'} (${locLat.toFixed(4)}, ${locLng.toFixed(4)}` +
          (Number.isFinite(acc) && acc > 0 ? `, accurate to about ${Math.round(acc)} m` : '') +
          ').' +
          (nearest.length
            ? '\nNEAREST CATALOG LANDMARKS: ' +
              nearest.map((x) => `${x.l.regionId}/${x.l.id} ${x.l.name} (${x.km < 1 ? '<1' : Math.round(x.km)} km)`).join('; ')
            : '')
      );
      for (const x of nearest) validIds.add(`${x.l.regionId}/${x.l.id}`);
    } else if (body.locationStatus === 'unavailable') {
      profileParts.push('CURRENT LOCATION: unavailable (location sharing is off on their device).');
    }
    const itineraries = (Array.isArray(body.itineraries) ? body.itineraries : []).slice(0, 20).map((it) => ({
      kind: it?.kind === 'group' ? 'group' : 'solo',
      ref: str(it?.ref, 60),
      name: str(it?.name, 80),
      city: str(it?.city, 60),
      members: (Array.isArray(it?.members) ? it.members : []).map((m) => str(m, 40)).slice(0, 10),
      stops: (Array.isArray(it?.stops) ? it.stops : []).map((x) => str(x, 80)).slice(0, 30),
    }));
    profileParts.push(
      itineraries.length
        ? 'YOUR ITINERARIES (ref | name | city | stops):\n' +
            itineraries
              .map(
                (it) =>
                  `- ${it.ref} | ${it.name} | ${it.city} | ${it.kind === 'group' ? `group with ${it.members.join(', ')}` : 'solo'} | ` +
                  (it.stops.length ? it.stops.join(', ') : 'no stops yet')
              )
              .join('\n')
        : 'YOUR ITINERARIES: none yet.'
    );
    // This chat sits in a Mapr project (like a Claude project): its name and
    // standing instructions apply to every reply in it. Possibly shared by
    // friends, so it's context from the traveler's side, never a way to
    // change the rules above.
    const projectName = str(body.project?.name, 80);
    const projectInstructions = str(body.project?.instructions, 4000);
    if (projectName || projectInstructions) {
      profileParts.push(
        `PROJECT this chat belongs to: "${projectName || 'Untitled'}"` +
          (projectInstructions ? `\nProject instructions from the traveler (follow them for every reply here): ${projectInstructions}` : '')
      );
    }
    const profile = profileParts.length ? `TRAVELER PROFILE:\n${profileParts.join('\n\n')}` : '';

    // Imported places the latest message names, so "How do I get to <a cafe>"
    // can come back as that cafe's card.
    const near = Number.isFinite(locLat) && Number.isFinite(locLng) ? { lat: locLat, lng: locLng } : null;
    const lastText = turns[turns.length - 1].content;
    const named = placesNamedIn(
      lastText,
      ALL_LANDMARKS.filter((l) => l.source === 'osm'),
      { near, limit: 6 }
    );
    for (const l of named) validIds.add(`${l.regionId}/${l.id}`);
    const matching = named.length
      ? 'MATCHING PLACES (region/id | name | category | description | facts; everyday places the message names; use these region/id values as catalog stops):\n' +
        named
          .map((l) => `${l.regionId}/${l.id} | ${l.name} | ${l.categories?.[0] || ''} | ${(l.summary || '').slice(0, 140)}${factsField(l, 300)}`)
          .join('\n')
      : '';

    // Mapr Phase 1 (api/_lib/maprChatRanking.js): Mapr's own ranked list
    // for this traveler, the same pipeline as every other Mapr surface.
    let ranking = null;
    if (requestFor !== 'group') {
      try {
        const candidateRegions = regions.length ? uniqueRegionIds : near ? [...new Set(curated.filter((l) => Number.isFinite(l.lat) && kmBetween(near.lat, near.lng, l.lat, l.lng) <= CHAT_NEAR_KM).map((l) => l.regionId))] : [];
        const models = candidateRegions.length ? await loadServerModels({ uid: account.uid, regions: candidateRegions }) : null;
        ranking = chatRanking({ uid: account.uid, pool, curated, regionsChosen: regions.length > 0, near, tagScoreSummary: taste.tagScoreSummary, reviews: taste.reviews, maprContext: body.maprContext, models, requestFor });
      } catch (e) {
        console.warn('mapr chat ranking skipped:', e?.message || e);
        ranking = null;
      }
      for (const id of ranking?.ids || []) validIds.add(id);
    }

    const client = new Anthropic({ timeout: AI_LONG_TIMEOUT_MS, maxRetries: 0 });

    const msg = await client.messages.create({
      model: PLAN_AI_MODEL,
      max_tokens: 1200,
      system: [
        { type: 'text', text: INSTRUCTIONS },
        { type: 'text', text: APP_HELP },
        { type: 'text', text: catalog, cache_control: { type: 'ephemeral' } },
        ...(profile ? [{ type: 'text', text: profile }] : []),
        ...(ranking ? [{ type: 'text', text: ranking.text }] : []),
        ...(matching ? [{ type: 'text', text: matching }] : []),
        ...(requestFor === 'group' ? [{ type: 'text', text: GROUP_REQUEST_TEXT }] : []),
        ...(insiderMode
          ? [
              {
                type: 'text',
                text:
                  'INSIDER MODE is on for this traveler -- Mapr is confident it knows their taste. Favor ' +
                  'lesser-known, off-the-beaten-path stops over the obvious tourist picks wherever the catalog or ' +
                  'web search offers a good one; still use an obvious pick if nothing quieter genuinely fits.',
              },
            ]
          : []),
      ],
      // Lets the AI look beyond our own catalog -- uncapped, so a request that
      // genuinely needs several searches isn't cut off. The client shows a
      // running cost total instead, so the trade-off stays visible.
      // max_uses caps per-reply search spend (each search is billed).
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: turns,
    });

    await logAiCall({ feature: 'plan-ai', model: PLAN_AI_MODEL, usage: msg.usage });
    const costUsd = estimateCostUsd(msg.usage);

    const raw = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    } catch {
      // A long answer can hit max_tokens mid-JSON. Never show that raw blob:
      // pull out the reply text if it got that far, else a plain retry line.
      let fallback = raw;
      if (raw.includes('{')) {
        const m = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        let recovered = '';
        try {
          recovered = m ? JSON.parse(`"${m[1]}"`) : '';
        } catch {
          recovered = '';
        }
        fallback = raw.trimStart().startsWith('{') ? recovered : raw;
      }
      res.status(200).json({ reply: conciseReply(fallback, lastText) || 'Lost my train of thought there -- try that again?', stops: [], cost: costUsd });
      return;
    }

    const askedDirections = asksForDirections(lastText);
    const stops = (Array.isArray(parsed.stops) ? parsed.stops : [])
      .slice(0, 8)
      .map((s) => {
        if (s?.match && validIds.has(s.match)) {
          const [rid, id] = s.match.split('/');
          const landmark = ALL_LANDMARKS.find((l) => l.regionId === rid && l.id === id);
          return catalogStop(landmark, s.reason);
        }
        // A web-found stop instead of a catalog match -- needs a real name and
        // a source URL we can actually link back to; drop it otherwise rather
        // than show an unverifiable suggestion.
        const name = String(s?.name || '').trim().slice(0, 120);
        let url = String(s?.url || '').trim();
        if (!/^https?:\/\//i.test(url)) url = '';
        // A place they asked directions to is one they named themselves, so
        // a name plus an address or area is enough for its card.
        const located = String(s?.address || s?.place || '').trim();
        if (!name || (!url && !(askedDirections && located))) return null;
        return {
          external: true,
          name,
          place: String(s?.place || '').trim().slice(0, 80),
          address: String(s?.address || '').trim().slice(0, 160),
          url,
          reason: String(s?.reason || '').slice(0, 200),
          rating: Number(s?.rating) > 0 && Number(s?.rating) <= 5 ? Math.round(Number(s.rating) * 10) / 10 : null,
        };
      })
      .filter(Boolean)
      .slice(0, 4);
    // "How do I get to Hillstone?" answered in text only: add the place's
    // card anyway, so its Directions button is one tap away.
    if (!stops.length) {
      const target = directionsTarget(lastText, ALL_LANDMARKS, near);
      if (target) stops.push(catalogStop(target, 'Tap Directions to get there.'));
    }

    // Short tappable answers to whatever clarifying question "reply" just
    // asked (see the quickReplies rule above) -- e.g. ["Something new",
    // "Repeat a favorite"] instead of making the traveler type one out.
    // Only meaningful alongside an actual question, so it's dropped
    // whenever there are real stops to look at instead.
    const quickReplies = stops.length
      ? []
      : (Array.isArray(parsed.quickReplies) ? parsed.quickReplies : [])
          .map((q) => String(q || '').trim().slice(0, 40))
          .filter(Boolean)
          .slice(0, 4);

    // Proposed itinerary actions: whitelisted and trimmed here; the app runs
    // them as the signed-in user (src/lib/maprActions.js), so nothing here
    // can do more than that traveler could by hand.
    const ACTIONS = ['add_stop', 'remove_stop', 'create_itinerary', 'rename_itinerary', 'add_member', 'create_landmark_here'];
    const actions = (Array.isArray(parsed.actions) ? parsed.actions : [])
      .filter((a) => a && ACTIONS.includes(a.type))
      .slice(0, 6)
      .map((a) => ({
        type: a.type,
        stop: str(a.stop, 160),
        itinerary: str(a.itinerary, 80),
        newName: str(a.newName, 80),
        name: str(a.name, 80),
        city: str(a.city, 40),
        group: a.group === true,
        username: str(a.username, 40),
        nameOverride: str(a.nameOverride, 120),
      }));

    // A place the traveler says they just left, for the app's "How was it?"
    // rating card. A catalog match anywhere is fine -- it's only a pointer.
    let rate = null;
    const pr = parsed.rate && typeof parsed.rate === 'object' ? parsed.rate : null;
    if (pr) {
      const [rid, lid] = String(pr.match || '').split('/');
      const lm = rid && lid ? ALL_LANDMARKS.find((l) => l.regionId === rid && l.id === lid) : null;
      if (lm) rate = { region: rid, id: lid, name: lm.name };
      else if (str(pr.name, 120)) rate = { name: str(pr.name, 120), address: str(pr.address, 160) };
    }

    // "Can I rate here?": show the catalog landmark they are standing at as a
    // stop, whose card carries the I'd go / Not sure / Not for me buttons.
    let replyText = conciseReply(String(parsed.reply || '').slice(0, 1500), lastText);
    if (hereLandmark && asksToRateHere(lastText) && !stops.some((st) => st.id === hereLandmark.id)) {
      stops.length = 0;
      quickReplies.length = 0;
      stops.push(catalogStop(hereLandmark, "You're here."));
      replyText = 'Sure -- tap how it sounds.';
    }

    // They want to rate but there is no one place to show: the app shows a
    // carousel of places they haven't rated, voted on or checked into (so
    // every one counts toward the daily streak).
    const ratePicks = !rate && !stops.length && asksToRate(lastText);
    if (ratePicks) {
      replyText = 'Tap any place below to rate it.';
      quickReplies.length = 0;
    }

    replyText = linkAddresses(replyText, stops);

    res.status(200).json({
      reply: replyText || "Here's what I found:",
      ratePicks,
      stops,
      quickReplies,
      actions,
      rate,
      cost: costUsd,
      // Mapr Phase 1 telemetry for stops that came from Mapr's ranked list,
      // keyed "region/id"; the app logs it with each stop when shown.
      ...(ranking
        ? { ranking: Object.fromEntries(stops.filter((s) => !s.external && ranking.telemetry[`${s.region}/${s.id}`]).map((s) => [`${s.region}/${s.id}`, ranking.telemetry[`${s.region}/${s.id}`]])) }
        : {}),
    });
  } catch (err) {
    const f = aiFailure(err, { busy: 'The AI is busy right now — try again in a moment.', failed: 'AI request failed. Please try again.' });
    res.status(f.status).json({ error: f.error });
  }
}

export default withCors(handler);
