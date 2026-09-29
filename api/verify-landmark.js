import Anthropic from '@anthropic-ai/sdk';
import { guardAiRequest } from './_lib/aiGuard.js';
import { verifyIdToken } from './_lib/verifyAuth.js';
import { enrichLandmark, reverseGeocode } from './_lib/enrichLandmark.js';
import { withCors } from './_lib/cors.js';

// Backs "Add Landmark" on the map: before a user-submitted spot gets saved as
// a real landmark, this asks the AI to sanity-check it's a genuine physical
// place worth adding -- not a joke, spam, or an unrelated photo -- and to
// write the short description/facts that make it feel like a real catalog
// entry instead of a bare pin.
//
// Important limitation: an LLM can't confirm a small local spot truly exists
// from a name + coordinates + one photo. This is a plausibility/moderation
// check (does the name, category, and photo look like a real submitted
// place?), not proof. The AI is explicitly told never to invent specific
// facts it can't know -- it only writes generic, honest filler unless the
// submitter supplied their own facts (optional), which are trusted at face
// value and just screened for appropriateness rather than fact-checked.
const INSTRUCTIONS =
  `You help moderate submissions to "Landmark Hunters", an app where people add real places for others to visit and check in at. ` +
  `A traveler submitted a name, one or more categories, an approximate location, and optionally a photo and/or a few facts they say ` +
  `are true about the place. Decide if this looks like a genuine, specific physical place worth adding -- reject joke/test/gibberish ` +
  `names, offensive content, or spam. If a photo was included, also reject one that isn't of a real place (a screenshot, a meme, a ` +
  `document, a random object with no place context, a selfie with no visible location, etc). Without a photo, judge on the name, ` +
  `categories, and location alone -- don't reject just for lacking one.\n\n` +
  `If it passes, write a SHORT, HONEST description. You do not actually know this specific place, so NEVER invent specific facts ` +
  `(no made-up history, dates, architects, or events) -- describe only what's generically true of its category (and what you can ` +
  `see in the photo, if one was included), and be upfront that it's a community-submitted spot.\n\n` +
  `For the final "facts" list: if the submitter gave their own facts, trust them (they know the place, you don't) -- include the ` +
  `ones that are plausible and appropriate, lightly cleaned up for grammar/length, and drop any that are spam, offensive, or clearly ` +
  `unrelated to the place. Do not fact-check specifics you can't verify; only drop a submitted fact for being inappropriate, not for ` +
  `being unverifiable. If the submitter gave none, you may add up to 2 safely generic facts of your own (e.g. "A popular spot for ` +
  `[category] near [area]") -- never your own fabricated specifics. Keep the submitter's own facts even if that's more than 2-3 -- ` +
  `an empty list is fine too if none of it holds up. Guess whether it's normally free to visit (default to true unless the ` +
  `category or photo, if included, strongly implies a paid attraction).\n\n` +
  `Reply with ONLY a JSON object, no other text:\n` +
  `{"ok": true|false, "reason": "<if ok is false, one short sentence why>", "summary": "<1-2 sentence honest description>", "facts": ["<fact>", ...], "free": true|false}`;

// Turned off by request -- submissions were getting rejected too often and
// it was making Add Landmark feel broken. Left in place (not deleted) so
// it's a one-line flip to turn back on once that's tuned or wanted again.
// While off, every submission is accepted outright with no accept/reject AI
// call at all (no plausibility screening, no photo check) -- there's no
// approval queue either (removed by request, see src/lib/customLandmarks.js),
// so this is the only remaining filter on what gets submitted.
const AI_MODERATION_ENABLED = false;

// Separate from moderation: this only researches and WRITES the summary/
// facts/free guess so a submitter doesn't have to type them by hand every
// time. Runs whenever ANTHROPIC_API_KEY is set, regardless of
// AI_MODERATION_ENABLED above -- it never accepts or rejects a submission,
// it only makes the auto-filled copy less generic. Uses Claude's web search
// tool for real grounding (unlike the old always-on filler, which could
// only guess); if search finds nothing specific or the call fails for any
// reason, this falls back to the same generic filler as before -- a
// submission is never blocked by this. Turn off by flipping this to false.
const AI_ENRICHMENT_ENABLED = true;

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (AI_MODERATION_ENABLED && !process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel.' });
    return;
  }
  // The client already requires sign-in to submit a landmark; this is the
  // server-side enforcement of that, since a request straight to this
  // endpoint could otherwise skip the UI check entirely. Also requires a
  // verified email (item f7) -- this is exactly the kind of account-backed
  // write a typo'd/fake email shouldn't be able to make.
  const account = await verifyIdToken(req);
  if (!account) {
    res.status(401).json({ error: 'Sign in first — adding a landmark needs an account.' });
    return;
  }
  if (!account.emailVerified) {
    // `code` lets the client detect this specific case (to auto-resend the
    // verification email) without matching on the message text.
    res.status(403).json({
      code: 'email-not-verified',
      error: 'Verify your email first — check your inbox for the link, then try again.',
    });
    return;
  }
  if (!(await guardAiRequest(req, res, { key: 'verify-landmark', limit: 15, windowMs: 10 * 60 * 1000, account }))) return;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const name = String(body.name || '').trim().slice(0, 80);
    const categories = Array.isArray(body.categories) ? body.categories.map((c) => String(c).slice(0, 40)).slice(0, 6) : [];
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    // Photo is optional -- only validate its shape when one was actually sent.
    const imageDataUrl = String(body.imageDataUrl || '');
    const match = imageDataUrl ? imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/) : null;
    const hasPhoto = !!match;
    const userFacts = Array.isArray(body.userFacts)
      ? body.userFacts.map((f) => String(f).trim().slice(0, 160)).filter(Boolean).slice(0, 5)
      : [];

    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || (imageDataUrl && !match)) {
      res.status(400).json({ error: 'Missing name or location.' });
      return;
    }

    // Best-effort reverse geocode for real-world grounding -- never blocks
    // the request if it fails or is slow. Used by both the enrichment and
    // (if re-enabled) the moderation call below.
    const placeContext = await reverseGeocode(lat, lng);

    if (!AI_MODERATION_ENABLED) {
      const fallback = {
        ok: true,
        reason: '',
        summary: userFacts.length
          ? ''
          : `A community-submitted spot${categories[0] ? ` (${categories[0]})` : ''}.`,
        facts: userFacts,
        free: true,
      };

      if (!AI_ENRICHMENT_ENABLED || !process.env.ANTHROPIC_API_KEY) {
        res.status(200).json(fallback);
        return;
      }

      try {
        const enriched = await enrichLandmark({ name, lat, lng, userFacts, placeContext, categories, hasPhoto });
        res.status(200).json({ ok: true, reason: '', ...enriched });
      } catch {
        // Search failed, timed out, or the AI's answer didn't parse --
        // never block the submission over this, just fall back to the
        // same generic filler used when enrichment is off entirely.
        res.status(200).json(fallback);
      }
      return;
    }

    const [, mediaType, imageB64] = hasPhoto ? match : [];

    const client = new Anthropic();
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: INSTRUCTIONS,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `Name: ${name}\n` +
                `Categories: ${categories.join(', ')}\n` +
                `Approximate location: ${placeContext || `${lat}, ${lng}`}\n` +
                (userFacts.length
                  ? `Facts the submitter says are true about this place:\n${userFacts.map((f) => `- ${f}`).join('\n')}\n`
                  : '') +
                (hasPhoto ? `Here's the submitted photo:` : `No photo was submitted.`),
            },
            ...(hasPhoto ? [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } }] : []),
          ],
        },
      ],
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
      // Can't parse the AI's answer -- fail closed rather than silently
      // publishing an unreviewed submission.
      res.status(200).json({ ok: false, reason: 'Could not verify this submission — try again.' });
      return;
    }

    res.status(200).json({
      ok: !!parsed.ok,
      reason: String(parsed.reason || '').slice(0, 200),
      summary: String(parsed.summary || '').slice(0, 300),
      facts: (Array.isArray(parsed.facts) ? parsed.facts : []).map((f) => String(f).slice(0, 160)).slice(0, 5),
      free: parsed.free !== false,
    });
  } catch (err) {
    const status = err?.status === 429 ? 429 : 500;
    res.status(status).json({
      error: status === 429 ? 'The AI is busy right now — try again in a moment.' : 'AI request failed. Please try again.',
    });
  }
}

export default withCors(handler);
