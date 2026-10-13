// Tips (docs/discovery-network-plan.md, Phase 1): a public note from a
// verified visit. Pure shared rules, no Firebase imports, so the app and
// api/post-tip.js check the same numbers.

export const TIP_MIN_CHARS = 10;
export const TIP_MAX_CHARS = 280;
export const TIP_MAX_TAGS = 3;
export const TIP_MAX_LINKS = 2;
// No links at all while an account is this new.
export const TIP_LINK_FREE_DAYS = 7;
// A tip rests on a verified check-in made this recently.
export const TIP_CHECKIN_MAX_AGE_DAYS = 30;
export const TIP_RATE_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 };
// Distinct reporters that hide a tip until the owner's review.
export const TIP_REPORT_HIDE = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

// The tags a tip may carry: practical, not opinion words.
export const TIP_TAGS = [
  { id: 'go-early', label: 'Go early' },
  { id: 'quiet', label: 'Quiet' },
  { id: 'busy', label: 'Gets busy' },
  { id: 'kids', label: 'Good with kids' },
  { id: 'free', label: 'Free' },
  { id: 'photo-spot', label: 'Photo spot' },
  { id: 'quick-stop', label: 'Quick stop' },
  { id: 'rainy-day', label: 'Rainy day' },
  { id: 'accessible', label: 'Step-free' },
  { id: 'views', label: 'Views' },
  { id: 'local-tip', label: 'Local know-how' },
];
const TAG_IDS = new Set(TIP_TAGS.map((t) => t.id));
export const tipTagLabel = (id) => TIP_TAGS.find((t) => t.id === id)?.label || null;

// One tip per person per place: the id says so.
export const tipIdFor = (uid, landmarkId) => `${uid}_${landmarkId}`;

// http(s) links, www. links and bare domains (example.com/path). Bare
// domains only for endings that aren't also words, so "views.Us kids",
// "gift shop.Store hours" or "Jo.Me and my wife" (a missing space) never
// count as links. The ending must be lowercase ("daily.Org groups" is a
// sentence, "Bellcafe.com" a link).
const LINK_RE = /\b(?:[Hh][Tt][Tt][Pp][Ss]?:\/\/|[Ww][Ww][Ww]\.)[^\s]+|\b[A-Za-z0-9][A-Za-z0-9-]{0,62}\.(?:com|net|org|io|ly|xyz)\b(?:\/[^\s]*)?/g;
export function countLinks(text) {
  return (String(text || '').match(LINK_RE) || []).length;
}

// Collapses runs of spaces and trims; keeps line breaks out.
export const cleanTipText = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

// Checks what the person typed. Returns null when it is fine, else a
// { code, message } the app shows as is.
//   accountAgeMs  how old the account is (null when unknown: treated as new)
export function tipInputProblem({ text, tags = [] }, { accountAgeMs = null } = {}) {
  const t = cleanTipText(text);
  if (t.length < TIP_MIN_CHARS) return { code: 'too-short', message: `A tip needs at least ${TIP_MIN_CHARS} characters.` };
  if (t.length > TIP_MAX_CHARS) return { code: 'too-long', message: `A tip can be at most ${TIP_MAX_CHARS} characters.` };
  if (!Array.isArray(tags) || tags.length > TIP_MAX_TAGS || new Set(tags).size !== tags.length || tags.some((x) => !TAG_IDS.has(x))) {
    return { code: 'bad-tags', message: `Pick up to ${TIP_MAX_TAGS} tags from the list.` };
  }
  const links = countLinks(t);
  const newAccount = !(Number.isFinite(accountAgeMs) && accountAgeMs >= TIP_LINK_FREE_DAYS * DAY_MS);
  if (links > 0 && newAccount) return { code: 'links-new-account', message: 'New accounts can post links after their first week.' };
  if (links > TIP_MAX_LINKS) return { code: 'too-many-links', message: `A tip can have at most ${TIP_MAX_LINKS} links.` };
  return null;
}

// Is this check-in one a tip can rest on?
export function tipCheckinProblem(checkin, uid, nowMs) {
  if (!checkin) return { code: 'no-checkin', message: 'Check in here first.' };
  if (checkin.userId !== uid) return { code: 'not-yours', message: "That's not your check-in." };
  if (checkin.ratingOnly === true || checkin.visited === false) return { code: 'not-a-visit', message: 'A tip needs a visit, not only a rating.' };
  if (checkin.presence?.verified !== true) return { code: 'not-verified', message: 'Tips need a verified visit.' };
  const at = checkin.createdAtMs;
  if (!Number.isFinite(at) || nowMs - at > TIP_CHECKIN_MAX_AGE_DAYS * DAY_MS) {
    return { code: 'too-old', message: `Tips need a verified visit from the last ${TIP_CHECKIN_MAX_AGE_DAYS} days.` };
  }
  return null;
}

// What a viewer may see: live and not hidden. (Blocks are the server's job.)
export const tipIsPublic = (tip) => !!tip && tip.status === 'live' && tip.hidden !== true;
