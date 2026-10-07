import Anthropic from '@anthropic-ai/sdk';
import { ALL_LANDMARKS } from '../src/data/regions.js';
import { guardAiRequest } from './_lib/aiGuard.js';
import { withCors } from './_lib/cors.js';
import { INTEREST_CLASSIFIER_MODEL } from './_lib/aiModels.js';
import { logAiCall } from './_lib/aiCallLog.js';
import { AI_LONG_TIMEOUT_MS, aiFailure } from './_lib/upstream.js';

// Custom interests (typed in on Setup, e.g. "nightlife", "racing") don't map to
// any of the app's four built-in categories, so they can't filter Choose
// Landmarks by tag matching alone. This asks the AI which real landmarks in the
// full catalog actually fit that topic, so a custom interest narrows the list
// the same way a built-in category does.
const DEFAULT_EMOJI = '\u{2728}'; // sparkle -- used whenever the AI's pick is missing or unusable

const INSTRUCTIONS =
  `You help the app "Landmark Hunters" match a traveler's custom interest to real landmarks. ` +
  `You have the full catalog below, one per line as "region/id | name | short description". ` +
  `Given one interest/topic, return every landmark from the catalog that a reasonable traveler would visit for that interest -- ` +
  `be inclusive of anything genuinely related, but don't force a match that isn't a real fit. An empty list is a valid answer if nothing in the catalog fits. ` +
  `Also pick exactly one emoji that best represents the interest itself (e.g. "racing" -> a race car, "baseball" -> a baseball) -- pick the single most specific, recognizable emoji for that word, not a generic one.\n\n` +
  `Reply with ONLY a JSON object, no other text:\n` +
  `{"matches": ["<region/id>", ...], "emoji": "<one emoji>"}\n` +
  `- Only use region/id values that appear in the catalog. NEVER invent one.`;

// Reads the model's reply. A broad interest can run past max_tokens mid-list,
// leaving invalid JSON; the ids written before the cut are still real matches,
// so keep them. Returns null when nothing usable came back.
export function parseClassification(raw, validIds, stopReason) {
  const clean = (list) => [...new Set(list.filter((m) => validIds.has(m)))];
  const pickEmoji = (e) => (typeof e === 'string' && e.trim().length > 0 && e.length <= 8 ? e.trim() : DEFAULT_EMOJI);
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    return { matches: clean(Array.isArray(parsed.matches) ? parsed.matches.map(String) : []), emoji: pickEmoji(parsed.emoji) };
  } catch {
    if (stopReason !== 'max_tokens') return null;
    const ids = clean([...raw.matchAll(/"([^"\\\s]+\/[^"\\\s]+)"/g)].map((m) => m[1]));
    return ids.length ? { matches: ids, emoji: DEFAULT_EMOJI } : null;
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
  if (!(await guardAiRequest(req, res, { key: 'classify-interest', limit: 30, windowMs: 10 * 60 * 1000 }))) return;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const interest = String(body.interest || '').trim().slice(0, 60);
    if (!interest) {
      res.status(400).json({ error: 'Missing interest.' });
      return;
    }

    const validIds = new Set(ALL_LANDMARKS.map((l) => `${l.regionId}/${l.id}`));
    const catalog =
      'CATALOG (region/id | name | description):\n' +
      ALL_LANDMARKS.map((l) => `${l.regionId}/${l.id} | ${l.name} | ${(l.summary || '').slice(0, 140)}`).join('\n');

    // Reads ANTHROPIC_API_KEY from env. A long reply (up to 6000 tokens) needs
    // the long budget; without one the SDK waits 10 minutes and retries, so
    // Vercel kills the function with a non-JSON page first.
    const client = new Anthropic({ timeout: AI_LONG_TIMEOUT_MS, maxRetries: 0 });

    const msg = await client.messages.create({
      model: INTEREST_CLASSIFIER_MODEL,
      max_tokens: 6000,
      // Catalog is identical every request → cache it so repeat calls are cheap.
      system: [
        { type: 'text', text: INSTRUCTIONS },
        { type: 'text', text: catalog, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: `Interest: ${interest}` }],
    });

    await logAiCall({ feature: 'interest-classifier', model: INTEREST_CLASSIFIER_MODEL, usage: msg.usage });

    const raw = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    const result = parseClassification(raw, validIds, msg.stop_reason);
    if (!result) {
      // Nothing usable (cut off before a single match, or not JSON at all):
      // a failure, not "no landmarks fit" -- the app would otherwise save an
      // empty match list and filter that interest to zero landmarks for good.
      res.status(502).json({ error: 'The AI could not match that interest. Please try again.' });
      return;
    }
    const { matches, emoji } = result;
    res.status(200).json({ matches, emoji });
  } catch (err) {
    const f = aiFailure(err, { busy: 'The AI is busy right now — try again in a moment.', failed: 'AI request failed. Please try again.' });
    res.status(f.status).json({ error: f.error });
  }
}

export default withCors(handler);
