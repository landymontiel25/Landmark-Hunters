// Quick-pick examples for the "tell Mapr what you like" nudge -- shown
// instantly (no AI round trip, just this list) so tapping a few chips is as
// fast as typing a sentence. Curated, not exhaustive: just enough per
// category to give someone something concrete to react to ("oh yeah, steak,
// not sushi") instead of staring at a blank box. Each example is a
// tri-state chip in TasteNudgeCard (neutral -> like -> dislike -> neutral),
// not just a like list -- this is meant to be the BASELINE Mapr starts
// from (what you like AND what you don't), which individual landmark
// ratings then refine with more specific reasons ("no pepper on my steak")
// as they come in. Chosen picks get folded into the same free-text
// tasteIntro a typed/spoken answer would produce, so they're read by the
// AI as prose either way.
export const TASTE_QUESTIONS = [
  {
    id: 'food',
    label: 'Food',
    icon: '\u{1F37D}\u{FE0F}',
    prompt: 'Like or hate any of these?',
    examples: ['Steak', 'Pizza', 'Sushi', 'Fine dining', 'Street food', 'Coffee shops'],
  },
  {
    id: 'history-culture',
    label: 'History & Culture',
    icon: '\u{1F3DB}\u{FE0F}',
    prompt: 'Like or hate any of these?',
    examples: ['Museums', 'Historic architecture', 'Old churches', 'Battlefields'],
  },
  {
    id: 'parks-nature',
    label: 'Parks & Nature',
    icon: '\u{1F333}',
    prompt: 'Like or hate any of these?',
    examples: ['Hiking trails', 'Scenic views', 'Beaches', 'Gardens'],
  },
  {
    id: 'entertainment',
    label: 'Entertainment',
    icon: '\u{1F39F}\u{FE0F}',
    prompt: 'Like or hate any of these?',
    examples: ['Live music', 'Comedy shows', 'Theme parks', 'Aquariums', 'Crowds / long lines'],
  },
  {
    id: 'sports',
    label: 'Sports & Activities',
    icon: '\u{1F3C0}',
    prompt: 'Like or hate any of these?',
    examples: ['Golf', 'Pickleball', 'Racing', 'Stadium games', 'Boating'],
  },
  {
    id: 'local-life',
    label: 'Local Life',
    icon: '\u{1F378}',
    prompt: 'Like or hate any of these?',
    examples: ['Nightlife / clubs', 'Dive bars', 'Farmers markets', 'Luxury / fancy spots'],
  },
];

// `baseline` is { [categoryId]: { [example]: 'like' | 'dislike' } }, as
// TasteNudgeCard/TasteProfileCard's edit flow build it. `categoryNotes`
// ({ [categoryId]: string }) is the per-category "Comment" field next to
// each question. Turned into plain prose ("Food: likes Steak, Fine dining;
// dislikes Sushi (note: no pepper on my steak)") so the AI reads it exactly
// like a typed answer -- see api/plan-ai.js and api/mapr-picks.js's IN
// THEIR OWN WORDS section.
export function baselineToSentence(baseline, categoryNotes) {
  if (!baseline) return '';
  return TASTE_QUESTIONS.filter((q) => (baseline[q.id] && Object.keys(baseline[q.id]).length) || categoryNotes?.[q.id])
    .map((q) => {
      const cat = baseline[q.id] || {};
      const likes = Object.keys(cat).filter((k) => cat[k] === 'like');
      const dislikes = Object.keys(cat).filter((k) => cat[k] === 'dislike');
      const parts = [];
      if (likes.length) parts.push(`likes ${likes.join(', ')}`);
      if (dislikes.length) parts.push(`dislikes ${dislikes.join(', ')}`);
      const note = categoryNotes?.[q.id]?.trim();
      if (note) parts.push(`note: ${note}`);
      return `${q.label}: ${parts.join('; ')}`;
    })
    .join('. ');
}

// Turns the same structured baseline into synthetic review-shaped objects
// (tier/categories/name/comment), so it can feed the leave-one-out
// prediction confidence in tasteProfile.js AND Mapr Picks' trait matching
// (maprPicks.js's keywordsIn) exactly like a real rating would -- a
// baseline "like" behaves like a highly-recommend, a "dislike" like a
// probably-skip, at the category level, and the category's Comment carries
// over as the comment text every pick in that category shares. This is how
// filling in the taste baseline actually moves the Taste Profile Score AND
// shapes Mapr's picks, not just a side effect of the free-text prompt
// reaching the AI.
export function baselineToSyntheticReviews(baseline, categoryNotes) {
  if (!baseline) return [];
  const out = [];
  for (const q of TASTE_QUESTIONS) {
    const cat = baseline[q.id];
    if (!cat) continue;
    const comment = categoryNotes?.[q.id] || '';
    for (const [example, state] of Object.entries(cat)) {
      out.push({
        tier: state === 'like' ? 'highly-recommend' : 'probably-skip',
        categories: [q.id],
        name: example,
        comment,
        highlights: [],
      });
    }
  }
  return out;
}

// favoritePlaces (Settings, "Tell me the places you visit most"): named
// places/brands, not categories -- "Dunkin' Donuts, sushi, Italian, arepa
// places, marinas, Carrot Express" tells Mapr far more specifically than
// "food" or "parks-nature" ever could. Read as prose, same as tasteIntro.
export function composeFavoritePlaces(myProfile) {
  const text = myProfile?.favoritePlaces?.trim();
  return text ? `Places/brands they said they visit most: ${text}.` : '';
}

// The full text sent to the AI as this traveler's taste profile -- free-form
// tasteIntro (onboarding/Settings), the structured baseline as prose
// (including per-category comments), any notes typed alongside it in the
// edit/nudge card, and the named favorite places/brands above, combined at
// read time so editing any of it later never means hunting through
// previously-saved sentences to avoid duplicating them.
export function composeTasteIntro(myProfile) {
  return [
    myProfile?.tasteIntro,
    baselineToSentence(myProfile?.tasteBaseline, myProfile?.tasteBaselineCategoryNotes),
    myProfile?.tasteBaselineNotes,
    composeFavoritePlaces(myProfile),
  ]
    .filter(Boolean)
    .join('. ');
}

// Cheap, deterministic fingerprint of everything a profile has told Mapr
// about taste (free-text intro, baseline picks, per-category comments) --
// this is "the master Mapr memory" of stated preferences, and every
// consumer of taste data should read it, not just the ones that happen to
// also read ratingsCount. Used to invalidate Mapr Picks' cache the instant
// any of it changes (see picksCacheKey in maprPicks.js), instead of only
// noticing on the next landmark rating or after the multi-hour TTL expires.
export function tasteFingerprint(myProfile) {
  // Answers to the "lean into [tag]?" prompt change Mapr Picks' ranking too.
  const text =
    composeTasteIntro(myProfile) +
    JSON.stringify([myProfile?.capAnswers, myProfile?.capNotes, myProfile?.tagBoosts, myProfile?.tagNotes]);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

// One-time recovery for accounts that answered the taste nudge BEFORE the
// structured tasteBaseline field existed (it used to bake baselineToSentence
// straight into the free-text tasteIntro, appended on every save -- see
// TasteNudgeCard's history). Those answers never went away, but the new
// Edit button has nothing to prefill its chips from since it only reads
// tasteBaseline, so they looked lost. This recognizes our own
// exact-format-generated sentences ("Food: likes Steak; dislikes Sushi")
// inside an old tasteIntro string, pulls them back out into a real
// baseline object, and returns whatever's left as the intro's remaining
// free text -- called once from TasteProfileCard, which then saves both
// fields and never needs to run this again (tasteBaseline stops being empty).
export function extractLegacyBaselineFromIntro(tasteIntro) {
  if (!tasteIntro) return { baseline: null, remainingIntro: tasteIntro || '' };
  const segments = tasteIntro.split('. ');
  const baseline = {};
  const leftover = [];
  let found = false;
  for (const seg of segments) {
    const trimmed = seg.trim();
    const q = TASTE_QUESTIONS.find((c) => trimmed.startsWith(`${c.label}: `));
    if (!q) {
      leftover.push(seg);
      continue;
    }
    const body = trimmed.slice(`${q.label}: `.length);
    const cat = {};
    for (const clause of body.split('; ')) {
      const likeMatch = clause.match(/^likes (.+)$/i);
      const dislikeMatch = clause.match(/^dislikes (.+)$/i);
      if (likeMatch) {
        for (const ex of likeMatch[1].split(', ')) cat[ex.trim()] = 'like';
      } else if (dislikeMatch) {
        for (const ex of dislikeMatch[1].split(', ')) cat[ex.trim()] = 'dislike';
      }
    }
    if (Object.keys(cat).length) {
      baseline[q.id] = cat;
      found = true;
    } else {
      leftover.push(seg);
    }
  }
  return { baseline: found ? baseline : null, remainingIntro: leftover.join('. ').trim() };
}
