// Pure helpers for scripts/find-commons-photos.mjs: decide whether a Wikimedia
// Commons file is a free-licensed photo of one specific landmark.

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'at', 'in', 'on', 'de', 'la', 'le', 'el', 'los', 'las', 'di', 'del', 'der', 'die', 'das', 'les']);

export const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const nameTokens = (s) => norm(s).split(' ').filter((t) => t && !STOP.has(t));

export const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

const LICENSE_OK = /^(public domain|cc0|pd\b|cc[ -]by(?:[ -]sa)?\b)/i;
export const licenseOk = (short) => LICENSE_OK.test(String(short || '').trim()) && !/\b(nc|nd)\b/i.test(short);
const needsAuthor = (short) => !/^(public domain|cc0|pd)/i.test(String(short || '').trim());

// One imageinfo entry (with extmetadata) -> a plain candidate, or null if it
// can never be used (wrong type, too small, non-free license, no author).
export function toCandidate(page) {
  const ii = page?.imageinfo?.[0];
  if (!ii) return null;
  const meta = ii.extmetadata || {};
  const license = stripHtml(meta.LicenseShortName?.value);
  const author = stripHtml(meta.Artist?.value);
  if (!/^image\/(jpeg|png)$/.test(ii.mime || '')) return null;
  if ((ii.width || 0) < 800 || (ii.width || 0) < (ii.height || 0) * 0.9) return null; // small, or clearly portrait
  if (!licenseOk(license)) return null;
  if (needsAuthor(license) && !author) return null;
  const title = String(page.title || '');
  return {
    title,
    width: ii.width,
    height: ii.height,
    license,
    licenseUrl: stripHtml(meta.LicenseUrl?.value),
    author: author.slice(0, 200),
    pageUrl: ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    text: norm([title.replace(/^File:/, ''), stripHtml(meta.ObjectName?.value), stripHtml(meta.ImageDescription?.value), stripHtml(meta.Categories?.value)].join(' ')),
    titleNorm: norm(title.replace(/^File:|\.[a-z]+$/gi, '')),
  };
}

// Score a candidate for a landmark; <= 0 means "not this place".
// nearMeters: distance of a geosearch hit from the landmark (null if not one).
export function scoreCandidate(landmark, c, nearMeters) {
  const tokens = nameTokens(landmark.name);
  if (!tokens.length) return 0;
  const hit = tokens.filter((t) => c.text.split(' ').includes(t)).length;
  const share = hit / tokens.length;
  const inTitle = c.titleNorm.includes(norm(landmark.name));
  // Every distinctive word of the name must appear (title, description or
  // categories); a lone one-word name needs 6+ letters so "Hall" never matches.
  if (share < 1) return 0;
  if (tokens.length === 1 && tokens[0].length < 6) return 0;
  const near = nearMeters != null && nearMeters <= 150;
  if (!inTitle && !near) return 0; // text match alone, with no location evidence, is too weak
  return 10 + (inTitle ? 6 : 0) + (near ? 4 : 0) + Math.min(3, c.width / 1500);
}

// Extra guard for bulk-imported places, whose names are often short or
// generic ("Cinema 6", "Vossen"): the photo must be geotagged within 150 m,
// or the file must name the area; a one-word name needs the geotag.
export function localEnough(landmark, c, nearMeters, area) {
  const near = nearMeters != null && nearMeters <= 150;
  if (near) return true;
  if (nameTokens(landmark.name).length < 2) return false;
  return area.test(c.text);
}

export function pickBest(landmark, scored) {
  const ok = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  return ok[0] || null;
}

export function resultFor(landmark, best) {
  const base = { region: landmark.region, id: landmark.id, name: landmark.name };
  if (!best) return { ...base, status: 'none', why: 'no verified free-licensed photo of this exact place on Commons' };
  const c = best.candidate;
  const file = c.title.replace(/^File:/, '');
  return {
    ...base,
    status: 'found',
    fileTitle: c.title,
    imageUrl: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=1200`,
    pageUrl: c.pageUrl,
    author: c.author,
    license: c.license,
    licenseUrl: c.licenseUrl,
    confidence: best.score >= 20 ? 'high' : 'medium',
    why: `name words match the file${best.near ? ' and it was taken within 150 m' : ''}`,
  };
}
