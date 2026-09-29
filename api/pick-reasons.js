import Anthropic from '@anthropic-ai/sdk';
import { getLandmark, INTERESTS } from '../src/data/regions.js';
import { isAdmin } from '../src/lib/admins.js';
import { guardAiRequest } from './_lib/aiGuard.js';
import { withCors } from './_lib/cors.js';
import { PICK_REASONS_MODEL } from './_lib/aiModels.js';
import { logAiCall } from './_lib/aiCallLog.js';

// One-line reasons for a set of nearby picks that were already ranked
// on-device (src/lib/nearbyPicks.js). One call covers the whole set; the
// model only writes the lines, it never picks or reorders places. The
// client shows a plain fallback line for any pick missing from the reply.
//
// Admin-only for now: it backs the Test tab's "Picked for you right now"
// preview, and every call is logged with isTest so it never counts toward
// real usage or Mapr's match rate.

export const MAX_PICKS = 8;

const INSTRUCTIONS =
  `You write one short line for each place on a traveler's "Picked for you right now" list in the app ` +
  `"Landmark Hunters". The places were already chosen by the app from the traveler's own ratings; do not judge ` +
  `or reorder them. Each line in the list is "key | name | category | kind of pick | why it was picked | description".\n\n` +
  `Kinds of pick:\n` +
  `- usual: a kind of place this traveler already rates highly.\n` +
  `- new: a kind of place they haven't tried much, that still fits their taste.\n` +
  `- chained: they usually go to this kind of place right after the kind named in "why it was picked".\n\n` +
  `Rules:\n` +
  `- Under 12 words, concrete, about the place itself and why it fits right now.\n` +
  `- Never invent facts beyond the description. No hours, prices, or distances.\n` +
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
    lines.push(`${key} | ${l.name} | ${LABELS[cat] || cat} | ${kind} | ${why} | ${(l.summary || '').slice(0, 160)}`);
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
  const account = await guardAiRequest(req, res, { key: 'pick-reasons', limit: 20, windowMs: 10 * 60 * 1000 });
  if (!account) return;
  if (!isAdmin(account.email)) {
    res.status(403).json({ error: 'This preview is admin-only.' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { lines, keys } = promptLines(body.picks);
    if (!lines.length) {
      res.status(200).json({ reasons: {} });
      return;
    }

    const client = new Anthropic();
    const msg = await client.messages.create({
      model: PICK_REASONS_MODEL,
      max_tokens: 600,
      system: [{ type: 'text', text: INSTRUCTIONS }],
      messages: [{ role: 'user', content: `PICKS:\n${lines.join('\n')}` }],
    });
    // Everything served from this endpoint is preview traffic.
    await logAiCall({ feature: 'pick-reasons-preview', model: PICK_REASONS_MODEL, usage: msg.usage, isTest: true });

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
    const status = err?.status === 429 ? 429 : 500;
    res.status(status).json({
      error: status === 429 ? 'Mapr is busy right now — try again in a moment.' : 'Mapr request failed. Please try again.',
    });
  }
}

export default withCors(handler);
