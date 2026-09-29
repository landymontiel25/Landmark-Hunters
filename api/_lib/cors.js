// CORS for the native iOS/Android app. Inside Capacitor the page origin is
// capacitor://localhost (iOS) or https://localhost (Android), so every call
// to these functions is cross-origin and the browser engine sends an OPTIONS
// preflight first (our requests carry Authorization + a JSON Content-Type).
// The web app is same-origin and never hits this path.
//
// This only decides which origins may read a response. The AI lockdown
// (verified Firebase sign-in + per-account rate limit, api/_lib/aiGuard.js)
// still runs inside each handler and is what actually stops abuse: CORS
// isn't an access control for non-browser clients.
const ALLOWED_ORIGINS = new Set(['capacitor://localhost', 'https://localhost']);

export function withCors(handler) {
  return async function corsHandler(req, res) {
    const origin = req.headers?.origin;
    if (origin && ALLOWED_ORIGINS.has(origin) && typeof res.setHeader === 'function') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    // Answer the preflight before the handler's method check, auth check and
    // rate limiter, none of which apply to it.
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return undefined;
    }
    return handler(req, res);
  };
}
