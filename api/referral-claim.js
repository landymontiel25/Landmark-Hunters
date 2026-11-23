// Thin entry point; the logic is in _lib/referralBonus.js, loaded on demand
// so a crash while loading it comes back as readable JSON.
export default async function handler(req, res) {
  try {
    const mod = await import('./_lib/referralClaimRoute.js');
    return await mod.default(req, res);
  } catch (e) {
    console.error('[referral-claim] failed', e);
    if (!res.headersSent) res.status(500).json({ error: `Server error: ${e?.message || e}` });
    return undefined;
  }
}
