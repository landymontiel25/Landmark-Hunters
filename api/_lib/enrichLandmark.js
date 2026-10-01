import Anthropic from '@anthropic-ai/sdk';
import { INTERESTS } from '../../src/data/regions.js';

// Shared by /api/verify-landmark (new submissions) and
// /api/backfill-landmark-facts (existing submissions that predate this
// feature) -- one place for the AI research call so both stay in sync.

const CATEGORY_LABEL = Object.fromEntries(INTERESTS.map((i) => [i.id, i.label]));
const CATEGORY_IDS = new Set(INTERESTS.map((i) => i.id));
// Given to the AI so it can only pick from real category ids -- never
// invent one. Kept to "id (Label)" so it's unambiguous which id to return.
const CATEGORY_LIST = INTERESTS.map((i) => `${i.id} (${i.label})`).join(', ');

export const ENRICHMENT_INSTRUCTIONS =
  `You help fill in details for a new landmark submitted to "Landmark Hunters", an app where people visit real places ` +
  `and check in -- essentially finishing the submission the way a human editor would, the same as every built-in ` +
  `catalog landmark already has: a summary, facts, a category, a typical visit length, and a photo. A user gave a name ` +
  `and an approximate location for a real physical place (the name may actually be an address, since that's what the ` +
  `location box auto-fills with when left blank). Use web search to find out what this specific place actually is, ` +
  `and write REAL, SPECIFIC facts about it from what you find -- never invent a fact you can't source. Search using ` +
  `the name, category (if given), and location together.\n\n` +
  `Name: if the given "name" is actually an address, a generic label, or otherwise clearly not this place's real name ` +
  `(e.g. "2234 Ponce De Leon Blvd"), and your search clearly identifies the actual business/landmark at that exact ` +
  `address/location, return its real name as "resolvedName" (e.g. "Sushi Maki") so the submission can be saved under ` +
  `its real name instead of the address. When you do this, also add the original address as one of the facts (e.g. ` +
  `"Located at 2234 Ponce De Leon Blvd") if it isn't already covered by another fact -- someone searching by the ` +
  `address they typed should still find it. If the given name already looks like a real, correct name for the place ` +
  `(a business name, a proper landmark name), or you can't confidently confirm a different real name at that exact ` +
  `spot, return null for "resolvedName" -- never guess or invent one.\n\n` +
  `Watch for name collisions with the category as your check: a place is often named after a sponsor, donor, or its ` +
  `own parent company (a company buys naming rights to a stadium, arena, hall, or building), so a name matching a ` +
  `well-known company or brand does NOT mean the place IS that company. If the category says something like a venue, ` +
  `stadium, arena, or building, and your first search results are about a business/company instead of an actual place ` +
  `matching that category, you have the wrong entity -- search again adding the category or words like "arena", ` +
  `"center", "stadium", or "hall" to the query (e.g. university/company name + category), and use facts about the ` +
  `real place, not the similarly-named company, even if the company is more prominent in search results.\n\n` +
  `Write every field as plain prose only -- no citation markers, no <cite> tags, no footnote numbers, no source names ` +
  `or brackets of any kind. This text is shown directly to app users, not as a research report.\n\n` +
  `If the submitter already gave their own facts, trust them (they're on the ground, you're not) -- keep those exactly ` +
  `as given (only clean up grammar), and add your own researched facts only to fill the list up to 5 total, never ` +
  `replacing or contradicting what they wrote. If they gave 5 or more already, don't add any.\n\n` +
  `Write a SHORT (1-2 sentence) honest summary of the place based on what your search actually finds. If search turns ` +
  `up nothing specific about this exact place (too small, too new, or just an address with no indexed business), say ` +
  `so plainly in the summary instead of guessing -- e.g. "A community-submitted spot; couldn't find more detail on it ` +
  `online yet." -- and lean on the submitter's own facts if they gave any.\n\n` +
  `Guess whether it's normally free to visit based on what you find (default to true unless search indicates a paid ` +
  `attraction or venue).\n\n` +
  `Category: if the message tells you the submitter already picked one, trust it and return null for "category" -- ` +
  `don't second-guess them. If none was given, pick the single best-fitting id from this exact list, based on what ` +
  `you find: ${CATEGORY_LIST}. Only return an id from that list, character-for-character -- never invent one, and ` +
  `return null if genuinely nothing fits.\n\n` +
  `Typical visit length: estimate "typicalMinutes" as a whole number of minutes a normal visit takes (e.g. 15, 30, 60, ` +
  `120), based on the category and what you find. A rough estimate is fine; return null only if you have no basis at ` +
  `all to guess.\n\n` +
  `Topic: return "topic" as a short (2-5 word) phrase for what kind of place this specifically is, more specific ` +
  `than the category and grounded in what your search actually found -- e.g. "Peruvian restaurant", "sports bar", ` +
  `"go-kart track", "Formula 1 circuit", "contemporary art museum", "botanical garden". It's shown to users as ` +
  `"Do you like this <topic>?", so write it as a singular noun phrase with no article, lowercase except proper nouns ` +
  `and adjectives (e.g. "Peruvian", "Formula 1"). Only return what search actually shows this exact place to be -- ` +
  `never guess from the name alone, never invent one; return null if search doesn't make it clear.\n\n` +
  `Hours: if your search turns up this specific place's real, current opening hours, return them as a short one-line ` +
  `string in "hours" (e.g. "Mon–Sat 10am–11pm, Sun 12pm–8pm", or "Open 24 hours"). Only return hours you actually found ` +
  `for this exact place -- never guess typical hours for the category, and never invent a schedule. If you're not ` +
  `confident or search doesn't surface hours, return null.\n\n` +
  `Photo: only if the submitter didn't already attach one AND your search turns up a specific real photo of this ` +
  `exact place on Wikimedia Commons or a Wikipedia page you actually found (not a generic stock photo, not a photo of ` +
  `a different branch/location, not a logo), return that file's exact Wikimedia Commons file name as ` +
  `"imageFileName" (e.g. "Golden_Gate_Bridge_from_Battery_Spencer.jpg" -- the exact name as it appears on Commons, ` +
  `including underscores and extension). If you're not confident it's a genuine photo of this specific place, or the ` +
  `submitter already has a photo, return null -- never guess or invent a file name; a missing photo is fine, a wrong ` +
  `one is not.\n\n` +
  `Reply with ONLY a JSON object, no other text:\n` +
  `{"resolvedName": "<the place's real name, or null>", "summary": "<1-2 sentence summary>", "facts": ["<fact>", ...], "free": true|false, "category": "<id from the list, or null>", "typicalMinutes": <number, or null>, "imageFileName": "<exact Wikimedia Commons file name, or null>", "hours": "<short hours string, or null>", "topic": "<2-5 word kind of place, or null>"}`;

export const TOPIC_MAX = 60;

// A short phrase, not a sentence the model wrote instead of following the
// schema -- anything longer than a handful of words is dropped, not trimmed.
export function cleanEnrichedTopic(raw) {
  if (typeof raw !== 'string') return null;
  const t = stripCitationTags(raw)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(a|an|the|this)\s+/i, '')
    .trim();
  if (!t || t.length > TOPIC_MAX || t.split(' ').length > 6 || t.toLowerCase() === 'null') return null;
  return t;
}

// Best-effort reverse geocode for real-world grounding -- never throws.
export async function reverseGeocode(lat, lng) {
  let placeContext = '';
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`,
      { headers: { Accept: 'application/json' }, signal: controller.signal }
    );
    clearTimeout(t);
    if (r.ok) {
      const data = await r.json();
      if (data?.display_name) placeContext = String(data.display_name).slice(0, 200);
    }
  } catch {
    // offline / rate-limited -- fine without it
  }
  return placeContext;
}

// The web search tool's citations sometimes leak into the model's own text
// as literal `(cite index="...">...</cite>` markup even when told not to --
// never trust the prompt alone for user-facing text. Strips the tags but
// keeps the cited text itself.
function stripCitationTags(text) {
  return typeof text === 'string' ? text.replace(/<\/?cite\b[^>]*>/gi, '').trim() : text;
}

// The model can only cite a file name it actually saw during search, but it
// can still get that wrong (a redirect, a renamed/deleted file, a name it
// misremembered) -- never trust "the AI said this is a real photo" for
// something shown to users. Confirms the constructed URL genuinely resolves
// to an image before it's ever saved. Returns null on any doubt.
async function verifyCommonsImage(fileName) {
  if (!fileName || typeof fileName !== 'string' || fileName.length > 200) return null;
  // Wikimedia file names: letters/digits/spaces/most punctuation, no path
  // separators or control characters -- reject anything that doesn't look
  // like a plausible file name before even trying to fetch it.
  if (!/^[^/\\<>]+\.[A-Za-z0-9]{2,5}$/.test(fileName)) return null;

  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=1200`;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const contentType = r.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;
    return url;
  } catch {
    return null;
  }
}

// Throws on any failure (bad response, unparseable JSON) -- callers decide
// what "couldn't enrich this one" should fall back to.
export async function enrichLandmark({ name, lat, lng, userFacts = [], placeContext = '', categories = [], hasPhoto = false }) {
  const categoryLabel = categories.map((c) => CATEGORY_LABEL[c] || c).join(', ');

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1500,
    system: ENRICHMENT_INSTRUCTIONS,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    messages: [
      {
        role: 'user',
        content:
          `Name: ${name}\n` +
          (categoryLabel ? `Category: ${categoryLabel}\n` : '') +
          `Approximate location: ${placeContext || `${lat}, ${lng}`}\n` +
          (hasPhoto ? 'The submitter already attached their own photo.\n' : 'The submitter did not attach a photo.\n') +
          (userFacts.length
            ? `Facts the submitter already gave (keep these, only add more to reach 5):\n${userFacts.map((f) => `- ${f}`).join('\n')}\n`
            : 'The submitter gave no facts of their own.'),
      },
    ],
    // A stalled web search must not leave the submitter on "Verifying…" for
    // minutes (SDK default is 10 min with retries) -- the caller falls back
    // to generic filler when this throws.
  }, { timeout: 40000, maxRetries: 0 });

  const raw = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));

  const category = typeof parsed.category === 'string' && CATEGORY_IDS.has(parsed.category) ? parsed.category : null;

  // Number(null) is 0, which would clamp to a bogus 5-minute visit.
  const typicalMinutesNum = parsed.typicalMinutes == null || parsed.typicalMinutes === '' ? NaN : Number(parsed.typicalMinutes);
  const typicalMinutes = Number.isFinite(typicalMinutesNum) ? Math.min(300, Math.max(5, Math.round(typicalMinutesNum))) : null;

  const imageUrl = !hasPhoto && parsed.imageFileName ? await verifyCommonsImage(parsed.imageFileName) : null;

  const resolvedNameRaw = typeof parsed.resolvedName === 'string' ? stripCitationTags(parsed.resolvedName).trim() : '';
  // Only worth it if it's an actual, different, plausible name -- not the
  // same name back, not empty, not absurdly long (a real name, not a
  // sentence the model wrote instead of following the schema).
  const resolvedName =
    resolvedNameRaw && resolvedNameRaw.length <= 80 && resolvedNameRaw.toLowerCase() !== String(name).trim().toLowerCase()
      ? resolvedNameRaw
      : null;

  const hoursRaw = typeof parsed.hours === 'string' ? stripCitationTags(parsed.hours).trim() : '';
  const hours = hoursRaw && hoursRaw.length <= 200 ? hoursRaw : null;

  return {
    resolvedName,
    summary: stripCitationTags(String(parsed.summary || '')).slice(0, 300),
    facts: (Array.isArray(parsed.facts) && parsed.facts.length ? parsed.facts : userFacts)
      .map((f) => stripCitationTags(String(f)).slice(0, 160))
      .slice(0, 5),
    free: parsed.free !== false,
    category,
    typicalMinutes,
    imageUrl,
    hours,
    topic: cleanEnrichedTopic(parsed.topic),
  };
}
