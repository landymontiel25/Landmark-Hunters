import Anthropic from '@anthropic-ai/sdk';
import { PHOTO_CHECK_MODEL } from './aiModels.js';
import { logAiCall } from './aiCallLog.js';
import { AI_TIMEOUT_MS } from './upstream.js';

// Two questions asked of Claude about a traveler's photo:
//   photoShowsPlace    the photo bonus (photoBonus.js): is this the place?
//   photoMatchesMission a photo mission (missionPhoto.js): does it do what
//                       the mission asks?
// Both resolve to { ok, reason, failed }: ok only on a clear yes; `failed`
// when the call itself didn't answer (never a verdict, so it can be asked
// again).

// The check-in already proved where they were (the server verifies the GPS
// visit), so this only turns away photos that clearly aren't the place
// (owner, 2026-11-22: a resort's tennis court photo was refused because the
// check only knew the resort as "Food"). The place's own description and
// its list of what's on the property go with every check.
const PLACE_INSTRUCTIONS =
  'A traveler checked in at a place (their phone GPS put them on site) and added this photo for a photo bonus. ' +
  'Decide whether the photo could have been taken at that place or on its grounds during the visit. ' +
  'Anything on the property counts: buildings, signs, grounds, courts, pools, beaches, docks, gardens, parking, the views from it, ' +
  'the inside, food or drinks there, an event or game there, or the traveler there. Large places such as resorts, parks and campuses ' +
  'cover many different scenes; use the description and the list of what is there. ' +
  'Answer false only when the photo clearly is not this place: a black, blank, very dark or unrecognizably blurry image; ' +
  'a screenshot of a screen; a meme, drawing or image from the internet; or a photo plainly of a different kind of place ' +
  '(a bedroom for a stadium, a snowy street for a beach resort). When in doubt, answer true. ' +
  'Give a short reason in plain words.';

const MISSION_INSTRUCTIONS =
  'A traveler at a landmark was given a photo mission and took this photo for it. Decide whether the photo does what the mission asks. ' +
  'It must show the mission’s subject: every thing the mission names should be visible, even if small, partial or from an odd angle. ' +
  'It does not need to be a good photo, and people in the frame are fine. ' +
  'Answer false when the subject is missing (a floor, a ceiling, a wall, a room, a close-up of something else, a different scene), ' +
  'or the image is black, blank, very dark or unrecognizably blurry, a screenshot, a meme or a picture from the internet. ' +
  'Give a short reason in plain words, saying what the photo shows.';

const SCHEMA = {
  type: 'object',
  properties: {
    matches: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['matches', 'reason'],
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

async function askAboutPhoto({ url, system, about, feature, client, log }) {
  if (!isStoragePhotoUrl(url)) return { ok: false, reason: 'not an app photo' };
  const anthropic = client || new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 1 });
  try {
    const msg = await anthropic.beta.messages.create({
      model: PHOTO_CHECK_MODEL,
      max_tokens: 1024,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system,
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
    await log({ feature, model: PHOTO_CHECK_MODEL, usage: msg.usage }).catch(() => {});
    if (msg.stop_reason === 'refusal') return { ok: false, reason: 'check declined', failed: true };
    const text = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const out = JSON.parse(text);
    return { ok: out.matches === true, reason: String(out.reason || '').slice(0, 200) };
  } catch (e) {
    console.error(`[${feature}] failed`, String(e?.message || e));
    return { ok: false, reason: 'check failed', failed: true };
  }
}

// What the check is told about a place: its name, kind, city, its own
// description, what's on the property, and the check-in area.
export function placeAbout(place) {
  const lines = [`Place: ${place.name}${place.kinds ? ` (${place.kinds})` : ''}${place.city ? `, ${place.city}` : ''}.`];
  if (place.description) lines.push(`About it: ${place.description}`);
  if (place.scenes?.length) lines.push(`On the property: ${place.scenes.join('; ')}.`);
  if (place.radiusMeters) lines.push(`The check-in area is ${place.radiusMeters} meters across the property.`);
  return lines.join('\n');
}

// place: { name, kinds, city, description, scenes, radiusMeters }.
export function photoShowsPlace({ url, place, client = null, log = logAiCall }) {
  return askAboutPhoto({ url, system: PLACE_INSTRUCTIONS, about: placeAbout(place), feature: 'photo-check', client, log });
}

// mission: the landmark's mission text.
export function photoMatchesMission({ url, place, mission, client = null, log = logAiCall }) {
  const about = `${placeAbout({ name: place.name, city: place.city, description: place.description })}\nThe mission: ${mission}`;
  return askAboutPhoto({ url, system: MISSION_INSTRUCTIONS, about, feature: 'mission-photo-check', client, log });
}
