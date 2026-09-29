import Anthropic from '@anthropic-ai/sdk';
import { ALL_LANDMARKS } from '../src/data/regions.js';
import { guardAiRequest } from './_lib/aiGuard.js';
import { withCors } from './_lib/cors.js';

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

    const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 3000,
      // Catalog is identical every request → cache it so repeat calls are cheap.
      system: [
        { type: 'text', text: INSTRUCTIONS },
        { type: 'text', text: catalog, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: `Interest: ${interest}` }],
    });

    const raw = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    } catch {
      res.status(200).json({ matches: [], emoji: DEFAULT_EMOJI });
      return;
    }

    const matches = (Array.isArray(parsed.matches) ? parsed.matches : []).filter((m) => validIds.has(m));
    const emoji = typeof parsed.emoji === 'string' && parsed.emoji.trim().length > 0 && parsed.emoji.length <= 8
      ? parsed.emoji.trim()
      : DEFAULT_EMOJI;
    res.status(200).json({ matches, emoji });
  } catch (err) {
    const status = err?.status === 429 ? 429 : 500;
    res.status(status).json({
      error: status === 429 ? 'The AI is busy right now — try again in a moment.' : 'AI request failed. Please try again.',
    });
  }
}

export default withCors(handler);
