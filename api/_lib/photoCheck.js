import Anthropic from '@anthropic-ai/sdk';
import { PHOTO_CHECK_MODEL } from './aiModels.js';
import { logAiCall } from './aiCallLog.js';
import { AI_TIMEOUT_MS } from './upstream.js';

// Does this photo show the place, or a visit there? Asked of Claude before
// the photo bonus pays (photoBonus.js), so a black screen, a screenshot, a
// meme or a photo of somewhere else earns nothing. Kept generous: food at a
// restaurant, the view from a park, the inside of a venue or the traveler
// there all count.
const INSTRUCTIONS =
  'A traveler checked in at a place (their phone was within 30 meters of it) and added this photo. ' +
  'Decide whether the photo plausibly shows that place or their visit there: the building, its sign, the view from it, ' +
  'the inside, food or drinks served there, an event or game there, or the traveler at the place. ' +
  'Answer false for: a black, blank, very dark or unrecognizably blurry image; a screenshot of a phone or computer screen; ' +
  'a meme, drawing or image from the internet; a photo plainly of somewhere else (a bedroom for a stadium, a beach for a museum); ' +
  'or anything with no connection to visiting a place. When it is a real photo that could have been taken there, answer true. ' +
  'Give a short reason in plain words.';

const SCHEMA = {
  type: 'object',
  properties: {
    shows_place: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['shows_place', 'reason'],
  additionalProperties: false,
};

// Only the app's own Firebase Storage photos are checked (the URL a client
// saved on its check-in or rating), never an arbitrary address.
export function isStoragePhotoUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'firebasestorage.googleapis.com' || u.hostname.endsWith('.firebasestorage.app'));
  } catch {
    return false;
  }
}

// place: { name, kinds, city }. Resolves to { ok, reason }; ok is false on
// anything but a clear yes (including a failed or refused call), so an
// error never pays.
export async function photoShowsPlace({ url, place, client = null, log = logAiCall }) {
  if (!isStoragePhotoUrl(url)) return { ok: false, reason: 'not an app photo' };
  const anthropic = client || new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 1 });
  const about = `Place: ${place.name}${place.kinds ? ` (${place.kinds})` : ''}${place.city ? `, ${place.city}` : ''}.`;
  try {
    const msg = await anthropic.beta.messages.create({
      model: PHOTO_CHECK_MODEL,
      max_tokens: 1024,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: INSTRUCTIONS,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url } },
            { type: 'text', text: about },
          ],
        },
      ],
    });
    await log({ feature: 'photo-check', model: PHOTO_CHECK_MODEL, usage: msg.usage }).catch(() => {});
    if (msg.stop_reason === 'refusal') return { ok: false, reason: 'check declined' };
    const text = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const out = JSON.parse(text);
    return { ok: out.shows_place === true, reason: String(out.reason || '').slice(0, 200) };
  } catch (e) {
    console.error('[photo-check] failed', String(e?.message || e));
    return { ok: false, reason: 'check failed' };
  }
}
