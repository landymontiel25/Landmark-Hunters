// Thin entry point. The real logic lives in _lib/missionAnswer.js and is
// loaded on demand, so a crash while loading it comes back to the app as
// readable JSON instead of a bare 500.
export default async function handler(req, res) {
  try {
    const mod = await import('./_lib/missionAnswer.js');
    return await mod.default(req, res);
  } catch (e) {
    console.error('[mission-answer] failed', e);
    if (!res.headersSent) res.status(500).json({ error: `Server error: ${e?.message || e}` });
    return undefined;
  }
}
