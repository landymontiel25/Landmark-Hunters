// Thin entry point. The real logic lives in _lib/closeSoloStreakDay.js and is
// loaded on demand, so a crash while loading it (a bad import, a missing
// package) comes back to the app as readable JSON instead of a bare 500.
export default async function handler(req, res) {
  try {
    const mod = await import('./_lib/closeSoloStreakDay.js');
    return await mod.default(req, res);
  } catch (e) {
    console.error('[close-solo-streak-day] failed', e);
    if (!res.headersSent) res.status(500).json({ error: `Server error: ${e?.message || e}` });
    return undefined;
  }
}
