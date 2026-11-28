// Thin entry point (like photo-bonus.js): the real logic loads on demand so a
// crash while loading it comes back as readable JSON instead of a bare 500.
export default async function handler(req, res) {
  try {
    const mod = await import('./_lib/communityPhotoBonus.js');
    return await mod.default(req, res);
  } catch (e) {
    console.error('[community-photo-bonus] failed', e);
    if (!res.headersSent) res.status(500).json({ error: `Server error: ${e?.message || e}` });
    return undefined;
  }
}
