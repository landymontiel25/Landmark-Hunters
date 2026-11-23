import Anthropic from '@anthropic-ai/sdk';
import { PHOTO_CHECK_MODEL, MISSION_PHOTO_CHECK_MODEL } from './aiModels.js';
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

// Loosened (owner, 2026-11-23): a real marina photo with docks and boats
// was refused for "no beach visible". The main subject at the place is
// enough; a second thing the mission names may be missing or out of frame.
const MISSION_INSTRUCTIONS =
  'A traveler at a landmark was given a photo mission and took this photo for it. Decide whether the photo shows the mission’s main subject at this place. ' +
  'The main subject is the first or central thing the mission names (for "the marina with the boats and the beach", the marina and its boats). ' +
  'Accept the photo when it clearly shows that main subject, even if other things the mission names are missing, small, partial or out of frame. ' +
  'It does not need to be a good photo, and people in the frame are fine. When in doubt, accept. ' +
  'Answer false only when the photo clearly does not show the place or its main subject at all: a floor, a ceiling, a wall, a room, ' +
  'a gray or blank texture, a black, very dark or unrecognizably blurry image, a screenshot, a meme, a picture from the internet, or somewhere else entirely. ' +
  'For "missing", name in one to four words what the mission wanted that the photo lacks (empty when nothing is missing). ' +
  'For "shows", say in two to six plain words what the photo shows. No sentences.';

// The verdict comes back as JSON in this shape (structured outputs). It
// used to be a forced tool call, which Claude Opus 5.5 refuses with a 400
// ("tool_choice: type \"tool\" and \"any\" are not supported for this
// model"), so every check failed before judging the photo (2026-11-23).
export const VERDICT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      matches: { type: 'boolean' },
      reason: { type: 'string' },
    },
    required: ['matches', 'reason'],
    additionalProperties: false,
  },
};

// A mission's verdict: two short phrases the traveler sees as bullets
// (owner, 2026-11-23): "Missing: beach" and "You took: marina with boats".
export const MISSION_VERDICT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      matches: { type: 'boolean' },
      missing: { type: 'string' },
      shows: { type: 'string' },
    },
    required: ['matches', 'missing', 'shows'],
    additionalProperties: false,
  },
};

const short = (x, n) => String(x || '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').slice(0, n);

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

// A call that didn't answer is recorded with its real error (ai_errors,
// server-only), so the cause is visible instead of a generic message.
async function recordFailure(feature, e, model = PHOTO_CHECK_MODEL) {
  try {
    const { adminDb } = await import('./firebaseAdmin.js');
    await Promise.race([
      adminDb()
        .collection('ai_errors')
        .add({
          feature,
          model,
          status: Number(e?.status) || null,
          type: String(e?.error?.error?.type || e?.name || 'error').slice(0, 100),
          message: String(e?.error?.error?.message || e?.message || e).slice(0, 500),
          at: new Date().toISOString(),
        }),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    /* logging never breaks the check */
  }
}

async function askAboutPhoto({ url, system, about, feature, client, log, onError = recordFailure, references = [], model = PHOTO_CHECK_MODEL, format = VERDICT_FORMAT }) {
  if (!isStoragePhotoUrl(url)) return { ok: false, reason: 'not an app photo' };
  const anthropic = client || new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 2 });
  try {
    const msg = await anthropic.messages.create({
      model,
      // Opus 5.5 always thinks first, and thinking counts toward
      // max_tokens: 512 could run out before the verdict was written.
      max_tokens: 4096,
      // Haiku 4.5 refuses an effort setting.
      output_config: model.startsWith('claude-haiku') ? { format } : { effort: 'low', format },
      system,
      messages: [
        {
          role: 'user',
          content: [
            // The place's own catalog photos first, labelled, so the
            // check can compare (anti-farming item 4).
            ...(references.length
              ? [{ type: 'text', text: "Reference photos of the place (from the app's catalog, not the traveler's):" }, ...references.map((r) => ({ type: 'image', source: { type: 'url', url: r } }))]
              : []),
            { type: 'text', text: references.length ? "The traveler's photo:" : 'Photo:' },
            { type: 'image', source: { type: 'url', url } },
            { type: 'text', text: about },
          ],
        },
      ],
    });
    await log({ feature, model, usage: msg.usage }).catch(() => {});
    if (msg.stop_reason === 'refusal') return { ok: false, reason: 'check declined', failed: true };
    let out = null;
    try {
      out = JSON.parse(msg.content.find((b) => b.type === 'text')?.text || 'null');
    } catch {
      out = null;
    }
    if (!out || typeof out.matches !== 'boolean') {
      await onError(feature, new Error(`no verdict (stop_reason ${msg.stop_reason})`));
      return { ok: false, reason: 'check failed', failed: true };
    }
    if ('shows' in out) {
      const missing = short(out.missing, 60);
      const shows = short(out.shows, 80);
      return { ok: out.matches === true, reason: [missing && `Missing: ${missing}`, shows && `You took: ${shows}`].filter(Boolean).join(' · '), missing, shows };
    }
    return { ok: out.matches === true, reason: String(out.reason || '').slice(0, 200) };
  } catch (e) {
    console.error(`[${feature}] failed`, String(e?.message || e));
    await onError(feature, e, model);
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
// Catalog photos worth sending as references: public Wikimedia files only,
// two at most.
export function referencePhotos(images) {
  return (Array.isArray(images) ? images : []).filter((u) => typeof u === 'string' && /^https:\/\/(upload|commons)\.wikimedia\.org\//.test(u)).slice(0, 2);
}

export function photoShowsPlace({ url, place, client = null, log = logAiCall }) {
  return askAboutPhoto({ url, system: PLACE_INSTRUCTIONS, about: placeAbout(place), feature: 'photo-check', client, log, references: referencePhotos(place.images) });
}

// mission: the landmark's mission text.
export function photoMatchesMission({ url, place, mission, client = null, log = logAiCall }) {
  const about = `${placeAbout({ name: place.name, city: place.city, description: place.description })}\nThe mission: ${mission}`;
  return askAboutPhoto({ url, system: MISSION_INSTRUCTIONS, about, feature: 'mission-photo-check', client, log, references: referencePhotos(place.images), model: MISSION_PHOTO_CHECK_MODEL, format: MISSION_VERDICT_FORMAT });
}
