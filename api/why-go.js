import Anthropic from '@anthropic-ai/sdk';
import { getLandmark, INTERESTS } from '../src/data/regions.js';
import { ensureServerPlacePacks } from './_lib/placePacks.js';
import { factsField } from './_lib/placeFacts.js';
import { guardAiRequest } from './_lib/aiGuard.js';
import { withCors } from './_lib/cors.js';
import { PICK_REASONS_MODEL } from './_lib/aiModels.js';
import { logAiCall } from './_lib/aiCallLog.js';
import { AI_TIMEOUT_MS, aiFailure } from './_lib/upstream.js';

// "Why you need to go" on an itinerary stop card (owner, 2026-11-15): three
// short lines in Mapr's voice that sell a traveler on a place. One call
// covers every stop on the trip. The server builds each prompt line from the
// catalog's own name, summary and sourced facts, looked up by id, so the
// client only chooses which places and the model can't be fed made-up
// details. The client caches the answer and shows honest category lines
// (src/lib/stopCard.js) for anything missing.

export const MAX_STOPS = 12;

const INSTRUCTIONS =
  `You're Mapr, the travel guide inside the app "Landmark Hunters". For each place on a traveler's trip, write ` +
  `exactly 3 short bullet lines on why they need to go. Each line in the list is ` +
  `"key | name | category | kind of place | description | facts (when known)".\n\n` +
  `Rules:\n` +
  `- Sell the place to a traveler: what they'll see, do or feel there, concrete and specific to that place.\n` +
  `- Use ONLY the description and facts given. Never invent a fact: no hours, prices, dates, events, awards, ` +
  `rankings, history or claims like "the best" unless a fact says it.\n` +
  `- Never say who goes there ("locals love it", "where locals gather") or what it means to the city, unless a fact says so.\n` +
  `- Never promise a visitor can use something (a pool, a room, a tour) unless a fact says visitors can.\n` +
  `- Keep a rumor a rumor: "rumored to be haunted" stays "rumored".\n` +
  `- No opinion words: best, famous, iconic, must-see, hidden gem, amazing, legendary, incredible, world-class, institution.\n` +
  `- With little data, write from the kind of place (what a traveler can do at a museum, a bar, a park) and keep it ` +
  `honest and general, without describing what's inside.\n` +
  `- First person as Mapr ("I'd", "I love that"), never "Mapr". Contractions everywhere (it's, you'll, don't). ` +
  `No em dashes or en dashes; use commas or periods. No exclamation marks. No emoji.\n` +
  `- Each line under 18 words, one sentence, ending with a period.\n` +
  `- Only use keys from the list.\n\n` +
  `Reply with ONLY this JSON, no other text:\n` +
  `{"why": {"<key>": ["<line 1>", "<line 2>", "<line 3>"], ...}}`;

const LABELS = Object.fromEntries(INTERESTS.map((i) => [i.id, i.label]));
const str = (v, n) => String(v ?? '').trim().slice(0, n);

// Keeps only stops that name a real catalog landmark, and builds each prompt
// line from the catalog's own data.
export function promptLines(stops) {
  const lines = [];
  const keys = new Set();
  for (const s of (Array.isArray(stops) ? stops : []).slice(0, MAX_STOPS)) {
    const region = str(s?.region, 40);
    const id = str(s?.id, 80);
    const l = region && id ? getLandmark(region, id) : null;
    const key = `${region}/${id}`;
    if (!l || keys.has(key)) continue;
    keys.add(key);
    const cat = l.categories?.[0] || '';
    lines.push(`${key} | ${l.name} | ${LABELS[cat] || cat} | ${str(l.topic, 40) || LABELS[cat] || 'place'} | ${(l.summary || '').slice(0, 200)}${factsField(l, 400)}`);
  }
  return { lines, keys };
}

// Words Mapr never uses (docs/design-language.md, section 9) and claims the
// data can't back. A line with one is dropped, and a place with fewer than
// 3 good lines gets the honest category lines on the client instead.
const BANNED = /\b(best|famous|iconic|must[- ]see|hidden gem|amazing|legendary|incredible|world[- ]class|institution|unmissable|locals? (love|gather|go|flock|swear))\b/i;

// Mapr's copy rules, enforced whatever the model sends: no dashes as
// punctuation, one sentence ending in a period, nothing about money.
export function cleanLine(v) {
  let line = str(v, 160)
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/!/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line || /\$|€|£/.test(line) || BANNED.test(line)) return '';
  if (!/[.?]$/.test(line)) line += '.';
  return line;
}

export function parseWhy(raw, keys) {
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const out = {};
    for (const [k, v] of Object.entries(parsed?.why || {})) {
      if (!keys.has(k) || !Array.isArray(v)) continue;
      const lines = v.map(cleanLine).filter(Boolean).slice(0, 3);
      if (lines.length === 3) out[k] = lines;
    }
    return out;
  } catch {
    return {};
  }
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
  if (!(await guardAiRequest(req, res, { key: 'why-go', limit: 20, windowMs: 10 * 60 * 1000 }))) return;

  try {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }
    await ensureServerPlacePacks();
    const { lines, keys } = promptLines(body.stops);
    if (!lines.length) {
      res.status(200).json({ why: {} });
      return;
    }

    const client = new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 0 });
    const msg = await client.messages.create({
      model: PICK_REASONS_MODEL,
      max_tokens: 1800,
      system: [{ type: 'text', text: INSTRUCTIONS }],
      messages: [{ role: 'user', content: `PLACES:\n${lines.join('\n')}` }],
    });
    await logAiCall({ feature: 'why-go', model: PICK_REASONS_MODEL, usage: msg.usage });

    if (msg.stop_reason === 'refusal') {
      res.status(200).json({ why: {} });
      return;
    }
    const raw = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    res.status(200).json({ why: parseWhy(raw, keys) });
  } catch (err) {
    const f = aiFailure(err, { busy: "I'm busy right now. Try again in a moment.", failed: "That didn't work. Try again in a moment." });
    res.status(f.status).json({ error: f.error });
  }
}

export default withCors(handler);
