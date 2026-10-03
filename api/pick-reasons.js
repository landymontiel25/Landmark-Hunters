import Anthropic from '@anthropic-ai/sdk';
import { getLandmark, INTERESTS } from '../src/data/regions.js';
import { ensureServerPlacePacks } from './_lib/placePacks.js';
import { factsField } from './_lib/placeFacts.js';
import { guardAiRequest } from './_lib/aiGuard.js';
import { withCors } from './_lib/cors.js';
import { PICK_REASONS_MODEL } from './_lib/aiModels.js';
import { logAiCall } from './_lib/aiCallLog.js';
import { AI_TIMEOUT_MS, aiFailure } from './_lib/upstream.js';

// One-line reasons for a set of nearby picks that were already ranked
// on-device (src/lib/nearbyPicks.js). One call covers the whole set; the
// model only writes the lines, it never picks or reorders places. The
// client shows a plain fallback line for any pick missing from the reply.
//
// Backs "Picked for you right now" on the Map tab, for any signed-in
// traveler: a verified sign-in and the shared per-account rate limit
// (guardAiRequest), like every other AI endpoint. The client caches each set
// for 4 hours, so a normal session makes a handful of calls at most.

export const MAX_PICKS = 8;

const INSTRUCTIONS =
  `You write one short line for each place on a traveler's "Picked for you right now" list in the app ` +
  `"Landmark Hunters". The places were already chosen by the app from the traveler's own ratings; do not judge ` +
  `or reorder them. Each line in the list is "key | name | category | kind of pick | why it was picked | description | facts (when known)".\n\n` +
  `Kinds of pick:\n` +
  `- usual: a kind of place this traveler already rates highly.\n` +
  `- new: a kind of place they haven't tried much, that still fits their taste.\n` +
  `- chained: they usually go to this kind of place right after the kind named in "why it was picked".\n\n` +
  `Rules:\n` +
  `- Under 12 words, concrete, about the place itself and why it fits right now.\n` +
  `- Never invent facts beyond the description and facts. No hours, prices, or distances.\n` +
  `- Only use keys from the list.\n\n` +
  `Reply with ONLY this JSON, no other text:\n` +
  `{"reasons": {"<key>": "<line>", ...}}`;

const LABELS = Object.fromEntries(INTERESTS.map((i) => [i.id, i.label]));
const str = (v, n) => String(v ?? '').trim().slice(0, n);

// Keeps only picks that name a real catalog landmark, and builds each
// prompt line from the catalog's own name/summary -- the client only
// chooses which landmarks and how they were picked.
export function promptLines(picks) {
  const lines = [];
  const keys = new Set();
  for (const p of (Array.isArray(picks) ? picks : []).slice(0, MAX_PICKS)) {
    const region = str(p?.region, 40);
    const id = str(p?.id, 80);
    const l = region && id ? getLandmark(region, id) : null;
    const key = `${region}/${id}`;
    if (!l || keys.has(key)) continue;
    keys.add(key);
    const cat = l.categories?.[0] || '';
    const kind = p?.chainFrom ? 'chained' : p?.pickType === 'new' ? 'new' : 'usual';
    const why = p?.chainFrom ? `after ${LABELS[str(p.chainFrom, 30)] || 'their last stop'}` : LABELS[cat] || cat;
    lines.push(`${key} | ${l.name} | ${LABELS[cat] || cat} | ${kind} | ${why} | ${(l.summary || '').slice(0, 160)}${factsField(l, 200)}`);
  }
  return { lines, keys };
}

export function parseReasons(raw, keys) {
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const out = {};
    for (const [k, v] of Object.entries(parsed?.reasons || {})) {
      const line = str(v, 120);
      if (keys.has(k) && line) out[k] = line;
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
  if (!(await guardAiRequest(req, res, { key: 'pick-reasons', limit: 20, windowMs: 10 * 60 * 1000 }))) return;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    await ensureServerPlacePacks();
    const { lines, keys } = promptLines(body.picks);
    if (!lines.length) {
      res.status(200).json({ reasons: {} });
      return;
    }

    const client = new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 0 });
    const msg = await client.messages.create({
      model: PICK_REASONS_MODEL,
      max_tokens: 600,
      system: [{ type: 'text', text: INSTRUCTIONS }],
      messages: [{ role: 'user', content: `PICKS:\n${lines.join('\n')}` }],
    });
    await logAiCall({ feature: 'pick-reasons', model: PICK_REASONS_MODEL, usage: msg.usage });

    if (msg.stop_reason === 'refusal') {
      res.status(200).json({ reasons: {} });
      return;
    }
    const raw = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    res.status(200).json({ reasons: parseReasons(raw, keys) });
  } catch (err) {
    const f = aiFailure(err, { busy: 'Mapr is busy right now — try again in a moment.', failed: 'Mapr request failed. Please try again.' });
    res.status(f.status).json({ error: f.error });
  }
}

export default withCors(handler);
