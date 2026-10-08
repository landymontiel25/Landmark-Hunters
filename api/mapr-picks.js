import Anthropic from '@anthropic-ai/sdk';
import { buildShortlist, swipeShortlist, noteKeywords } from '../src/lib/tagScores.js';
import { getRegion } from '../src/data/regions.js';
import { guardAiRequest } from './_lib/aiGuard.js';
import { ensureServerPlacePacks } from './_lib/placePacks.js';
import { factsField } from './_lib/placeFacts.js';
import { withCors } from './_lib/cors.js';
import { AI_TIMEOUT_MS, aiFailure } from './_lib/upstream.js';

// "Your Mapr Picks" on Profile. The internal tag scorer (src/lib/tagScores.js)
// ranks the traveler's current region down to a 30-landmark shortlist from
// their per-region tag scores (or, with no ratings there yet, their signup
// interests by check-in count). Claude only picks and explains the final 8
// from that shortlist; it never sees the full rating history.
const INSTRUCTIONS =
  `You are Mapr, the taste engine inside the app "Landmark Hunters". You get a SHORTLIST of real landmarks the ` +
  `traveler has NOT visited, already ranked by an internal score built from their ratings in this region, one per ` +
  `line as "region/id | name | category | short description | facts (when known) | fit score | ratings behind that score | check-ins | ` +
  `distance", with WILDCARD at the end of some lines. You also get ` +
  `their few most recent ratings (for tone, not math), anything they told Mapr in their own words, and TAG NOTES: ` +
  `comments they left about a category they love. Pick the 8 shortlist landmarks this traveler is most likely to ` +
  `love next, most confident first.\n\n` +
  `Rules:\n` +
  `- The fit score already did the math over their full history. Treat it as a strong prior, then use your judgment ` +
  `on the specific place: its description, their recent ratings and comments, their own words and TAG NOTES.\n` +
  `- TAG NOTES are the traveler's words about what they want more of in that category. Honor them when choosing ` +
  `among places in that category.\n` +
  `- Go past the broad category to the SPECIFIC kind of place. If a recent rating or their own words rule out a ` +
  `specific kind (a zoo, a cemetery, a private club, whatever it is), skip other places of that kind even when the ` +
  `category scores well.\n` +
  `- CITY is the city you're picking for right now. If their own words state a city-specific exception ("I don't ` +
  `usually like museums, but in Paris show me more") that names or clearly means THIS city, follow it even if it ` +
  `contradicts their general fit scores or ratings from other cities. An exception named for a different city never ` +
  `applies here.\n` +
  `- A fit score backed by 1-2 ratings is a guess; the same score backed by 10+ ratings is proven. Trust it accordingly.\n` +
  `- WILDCARD lines are deliberate exploration: categories this traveler has barely rated, so Mapr can find new ` +
  `interests instead of only repeating known ones. Include 1-2 wildcards among the 8 when one looks like a real ` +
  `standout (well visited, distinctive), give them an honest modest matchPercentage (60s-70s), and never let them ` +
  `push out a clearly stronger fit.\n` +
  `- If the list says COLD START, the traveler has no ratings here yet: the shortlist is their signup interests ` +
  `ordered by how many people checked in. Lean on that popularity, and keep matchPercentage modest (60s-70s).\n` +
  `- Prefer variety across the 8 unless their taste is clearly single-minded. Among close fits, prefer the closer place.\n` +
  `- matchPercentage is your honest confidence this traveler will love this place, 60-99. Don't inflate weak fits, ` +
  `and it's fine to return fewer than 8.\n` +
  `- oneLineSummary: under 12 words, concrete, about the place itself (not "you'll love it").\n` +
  `- Only use region/id values that appear in the shortlist. Never invent one.\n\n` +
  `Reply with ONLY this JSON, no other text:\n` +
  `{"picks": [{"match": "<region/id>", "matchPercentage": <60-99>, "oneLineSummary": "<text>"}, ...]}`;

// Signup swipes + notes, no ratings yet: the shortlist itself was already
// built from ONLY what the traveler swiped/wrote (swipeShortlist in
// tagScores.js) -- no signup-interest chips, no plain city popularity
// outside that. Claude's job here is narrower: pick and explain the best 8
// of THIS already-filtered list, leaning hard on their own words.
const SWIPE_INSTRUCTIONS =
  `You are Mapr, the taste engine inside the app "Landmark Hunters". A brand-new traveler just swiped through ` +
  `preference cards and (optionally) wrote a few words about what they love. You get a SHORTLIST built entirely ` +
  `from that swipe/notes signal -- nothing here came from generic city popularity or unrelated categories -- one ` +
  `per line as "region/id | name | category | short description | facts (when known) | fit score | check-ins | distance". You also get ` +
  `their own words verbatim. Pick the 8 shortlist landmarks this traveler is most likely to love, most confident first.\n\n` +
  `Rules:\n` +
  `- Trust the shortlist: every line already matched something they swiped "love it" on, or a word from their own ` +
  `notes. Your job is choosing and explaining the best 8 of THESE, not second-guessing whether they belong.\n` +
  `- Lean heavily on their own words. If they named something specific (a place type, a vibe, a cuisine), prefer ` +
  `lines that clearly fit that over a generic member of the same broad category.\n` +
  `- Never pick a place outside their loved categories or their own words just to fill out variety -- a shorter, ` +
  `tighter list of 8 beats padding with something unrelated.\n` +
  `- Among close fits, prefer the closer place and the one with more check-ins.\n` +
  `- matchPercentage is your honest confidence, 60-99. It's fine to return fewer than 8 if the shortlist is short.\n` +
  `- oneLineSummary: under 12 words, concrete, about the place itself (not "you'll love it").\n` +
  `- Only use region/id values that appear in the shortlist. Never invent one.\n\n` +
  `Reply with ONLY this JSON, no other text:\n` +
  `{"picks": [{"match": "<region/id>", "matchPercentage": <60-99>, "oneLineSummary": "<text>"}, ...]}`;

const str = (v, n) => String(v ?? '').trim().slice(0, n);

// Haversine, inlined: src/lib/geo.js uses Vite-style extensionless imports
// that plain Node (where Vercel runs this) can't resolve.
function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel.' });
    return;
  }
  if (!(await guardAiRequest(req, res, { key: 'mapr-picks', limit: 12, windowMs: 10 * 60 * 1000 }))) return;

  try {
    // A malformed body is the caller's 400, not an "AI request failed" 500
    // logged as an upstream failure.
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }
    const region = str(body.region, 40);
    if (!region) {
      res.status(200).json({ picks: [] });
      return;
    }
    await ensureServerPlacePacks();
    // users/{uid} tag maps (see tagScores.js). Scores, timestamps and counts
    // come for every region, since the warm start borrows from the others.
    const numMap = (m, cap = 40) =>
      Object.fromEntries(
        Object.entries(m && typeof m === 'object' ? m : {})
          .slice(0, cap)
          .map(([k, v]) => [str(k, 40), Number(v)])
          .filter(([, v]) => Number.isFinite(v))
      );
    const strMap = (m, n) =>
      Object.fromEntries(
        Object.entries(m && typeof m === 'object' ? m : {})
          .slice(0, 40)
          .map(([k, v]) => [str(k, 40), str(v, n)])
          .filter(([, v]) => v)
      );
    const nestedNumMap = (m) =>
      Object.fromEntries(
        Object.entries(m && typeof m === 'object' ? m : {})
          .slice(0, 40)
          .map(([k, v]) => [str(k, 40), numMap(v)])
      );
    // At-cap prompt answers and notes, one per tag across every region.
    const tagNotes = strMap(body.capNotes, 500);
    const profile = {
      tagScores: nestedNumMap(body.tagScores),
      tagScoresAt: nestedNumMap(body.tagScoresAt),
      tagCounts: nestedNumMap(body.tagCounts),
      capAnswers: strMap(body.capAnswers, 3),
    };
    const checkinCounts = numMap(body.checkinCounts, 2000);
    const excludeIds = (Array.isArray(body.excludeIds) ? body.excludeIds : []).slice(0, 2000).map((id) => str(id, 80));
    // Signup: swipe cards + notes, no ratings yet. The shortlist is built
    // from ONLY that signal (swipeShortlist), never signup-interest chips
    // or plain city popularity -- see SWIPE_INSTRUCTIONS above.
    const swipeOnly = body.mode === 'swipeOnly';
    const tasteIntroPre = str(body.tasteIntro, 4000);
    const { coldStart, shortlist } = swipeOnly
      ? { coldStart: false, shortlist: swipeShortlist({ region, tagDeltas: profile.tagScores.all || profile.tagScores[region] || {}, keywords: noteKeywords(tasteIntroPre), excludeIds, checkinCounts }) }
      : buildShortlist({
          profile,
          region,
          excludeIds,
          checkinCounts,
          interests: (Array.isArray(body.interests) ? body.interests : []).map((c) => str(c, 30)).slice(0, 20),
          customMatchIds: (Array.isArray(body.customMatchIds) ? body.customMatchIds : []).map((id) => str(id, 120)).slice(0, 300),
        });
    if (!shortlist.length) {
      res.status(200).json({ picks: [] });
      return;
    }
    const recentReviews = (Array.isArray(body.recentReviews) ? body.recentReviews : [])
      .filter((r) => r && typeof r === 'object')
      .slice(-10)
      .map((r) => ({
      name: str(r.name, 80),
      tier: str(r.tier, 30),
      categories: (Array.isArray(r.categories) ? r.categories : []).map((c) => str(c, 30)).slice(0, 3),
      highlights: (Array.isArray(r.highlights) ? r.highlights : []).map((h) => str(h, 40)).slice(0, 3),
      comment: str(r.comment, 280),
    }));
    // Told directly at onboarding or from Settings (taste intro, baseline,
    // weekday/weekend/mood preferences), read as prose.
    const tasteIntro = tasteIntroPre;
    const origin =
      body.origin && Number.isFinite(Number(body.origin.lat)) && Number.isFinite(Number(body.origin.lng))
        ? { lat: Number(body.origin.lat), lng: Number(body.origin.lng) }
        : null;

    const validIds = new Map(shortlist.map((l) => [`${l.regionId}/${l.id}`, l]));
    const shortlistLine = (l) => {
      const km = origin ? distanceKm(origin.lat, origin.lng, l.lat, l.lng) : null;
      const dist = km != null ? ` | ${km < 10 ? km.toFixed(1) : Math.round(km)} km` : '';
      return swipeOnly
        ? `${l.regionId}/${l.id} | ${l.name} | ${l.categories?.[0] || ''} | ${(l.summary || '').slice(0, 120)}${factsField(l, 200)}` +
            ` | ${l.tagScore} | ${checkinCounts[l.id] || 0}${dist}`
        : `${l.regionId}/${l.id} | ${l.name} | ${l.categories?.[0] || ''} | ${(l.summary || '').slice(0, 120)}${factsField(l, 200)}` +
            ` | ${l.tagScore} | ${l.tagRatings} | ${checkinCounts[l.id] || 0}${dist}` +
            (l.wildcard ? ' | WILDCARD' : '');
    };
    const regionName = getRegion(region)?.name || region;
    const prompt =
      `CITY: ${regionName}\n\n` +
      (!swipeOnly && coldStart ? 'COLD START: no ratings in this region yet.\n\n' : '') +
      (tasteIntro ? `IN THEIR OWN WORDS: "${tasteIntro}"\n\n` : '') +
      (Object.keys(tagNotes).length
        ? 'TAG NOTES (category: what they told us):\n' +
          Object.entries(tagNotes)
            .map(([tag, note]) => `- ${tag}: "${note}"`)
            .join('\n') +
          '\n\n'
        : '') +
      (recentReviews.length
        ? 'RECENT RATINGS (oldest first):\n' +
          recentReviews
            .map(
              (r) =>
                `- ${r.name} [${r.categories.join(', ') || '?'}]: ${r.tier || 'rated'}` +
                (r.highlights.length ? ` — ${r.highlights.join(', ')}` : '') +
                (r.comment ? ` — "${r.comment}"` : '')
            )
            .join('\n') +
          '\n\n'
        : '') +
      (swipeOnly
        ? 'SHORTLIST (region/id | name | category | description | facts | fit score | check-ins | distance), best internal score first:\n'
        : 'SHORTLIST (region/id | name | category | description | facts | fit score | ratings behind it | check-ins | distance), best internal score first:\n') +
      shortlist.map(shortlistLine).join('\n');

    const client = new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 0 });
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1400,
      // Ranking a short list is routine work; low effort keeps it quick.
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-06-01'],
      fallbacks: [{ model: 'claude-opus-4-8' }],
      system: [{ type: 'text', text: swipeOnly ? SWIPE_INSTRUCTIONS : INSTRUCTIONS, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });

    if (msg.stop_reason === 'refusal') {
      res.status(200).json({ picks: [] });
      return;
    }
    const raw = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    let parsed;
    try {
      parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    } catch {
      res.status(200).json({ picks: [] });
      return;
    }

    const seen = new Set();
    const picks = (Array.isArray(parsed.picks) ? parsed.picks : [])
      .map((p) => {
        const landmark = validIds.get(str(p?.match, 120));
        if (!landmark || seen.has(landmark.id)) return null;
        seen.add(landmark.id);
        const pct = Math.round(Number(p?.matchPercentage));
        return {
          id: landmark.id,
          region: landmark.regionId,
          name: landmark.name,
          image: landmark.images?.[0] || null,
          categories: landmark.categories || [],
          matchPercentage: Number.isFinite(pct) ? Math.min(99, Math.max(60, pct)) : 80,
          oneLineSummary: str(p?.oneLineSummary, 90) || (landmark.summary || '').split(/[.!?]/)[0].slice(0, 90),
          wildcard: !!landmark.wildcard,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.matchPercentage - a.matchPercentage)
      .slice(0, 8);

    res.status(200).json({ picks, coldStart });
  } catch (err) {
    const f = aiFailure(err, { busy: 'Mapr is busy right now — try again in a moment.', failed: 'Mapr request failed. Please try again.' });
    res.status(f.status).json({ error: f.error });
  }
}

export default withCors(handler);
