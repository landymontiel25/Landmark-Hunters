import Anthropic from '@anthropic-ai/sdk';
import { ALL_LANDMARKS, getRegion } from '../src/data/regions.js';
import { guardAiRequest } from './_lib/aiGuard.js';
import { withCors } from './_lib/cors.js';
import { AI_TIMEOUT_MS, aiFailure } from './_lib/upstream.js';

// "Figure out what I mean" for every search box in the app (src/lib/
// smartSearch.js). The client only calls this when its own typo-tolerant
// search came up short, so it's the fallback for descriptions, nicknames,
// translations and badly misspelled words: "the big clock in london", "rocky
// steps", "that church with the bones". It never invents anything -- it only
// picks from the candidates it's given: the built-in catalog (pool
// "catalog", built here and cached) and/or the client's own list (a
// traveler's check-ins, the city list, custom landmarks).
const INSTRUCTIONS =
  `You match a search typed into the travel app "Landmark Hunters" to items in a list. People type nicknames, ` +
  `descriptions, what a place is known for, a movie or event connection, translations, or badly misspelled words. ` +
  `Work out what they mean and pick the items that match it, best match first -- at most 8. Only pick items that ` +
  `genuinely fit; return an empty list rather than a loose guess.\n\n` +
  `Reply with ONLY a JSON object: {"ids": ["<id>", ...]}. Use ids exactly as they appear before the first "|".`;

const CATALOG =
  'CATALOG ITEMS (id | name | city | what it is):\n' +
  ALL_LANDMARKS.map(
    (l) => `${l.regionId}/${l.id} | ${l.name} | ${getRegion(l.regionId)?.name || ''} | ${(l.summary || '').slice(0, 110)}`
  ).join('\n');
const CATALOG_IDS = new Set(ALL_LANDMARKS.map((l) => `${l.regionId}/${l.id}`));

const MAX_ITEMS = 400;
const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel.' });
    return;
  }
  if (!(await guardAiRequest(req, res, { key: 'smart-search', limit: 40, windowMs: 10 * 60 * 1000 }))) return;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const query = str(body.query, 120);
    if (query.length < 2) {
      res.status(200).json({ ids: [] });
      return;
    }
    const useCatalog = body.catalog === true;
    const items = (Array.isArray(body.items) ? body.items : [])
      .slice(0, MAX_ITEMS)
      .map((it) => ({ id: str(it?.id, 120), text: str(it?.text, 200) }))
      .filter((it) => it.id && it.text && !it.id.includes('|'));
    if (!useCatalog && !items.length) {
      res.status(200).json({ ids: [] });
      return;
    }
    const itemIds = new Set(items.map((it) => it.id));

    const system = [{ type: 'text', text: INSTRUCTIONS }];
    if (useCatalog) system.push({ type: 'text', text: CATALOG, cache_control: { type: 'ephemeral' } });
    const extra = items.length ? `ITEMS (id | description):\n${items.map((it) => `${it.id} | ${it.text}`).join('\n')}\n\n` : '';

    const msg = await new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 0 }).messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: `${extra}Search: "${query}"` }],
    });
    const raw = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    let parsed = {};
    try {
      parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    } catch {
      /* unparseable -> no matches */
    }
    const ids = [
      ...new Set(
        (Array.isArray(parsed.ids) ? parsed.ids : [])
          .map((id) => String(id).trim())
          .filter((id) => itemIds.has(id) || (useCatalog && CATALOG_IDS.has(id)))
      ),
    ].slice(0, 8);
    res.status(200).json({ ids });
  } catch (err) {
    const f = aiFailure(err, { busy: 'The AI is busy right now — try again in a moment.', failed: 'Smart search failed.' });
    res.status(f.status).json({ error: f.error });
  }
}

export default withCors(handler);
