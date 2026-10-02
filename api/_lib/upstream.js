// Upstream-call limits shared by the API handlers. Vercel kills a function at
// its maxDuration (vercel.json, 60s) with a non-JSON 504 page, which the app
// can't turn into a friendly message -- so every Anthropic/Google call gets a
// shorter budget of its own and the handler answers with JSON instead.
export const GOOGLE_TIMEOUT_MS = 15000;
export const AI_TIMEOUT_MS = 25000;
// Mapr chat can run several web searches before it answers.
export const AI_LONG_TIMEOUT_MS = 50000;

export function timeoutSignal(ms = GOOGLE_TIMEOUT_MS) {
  return AbortSignal.timeout(ms);
}

export function isTimeoutError(err) {
  const n = String(err?.name || '');
  return n === 'TimeoutError' || n === 'AbortError' || n === 'APIConnectionTimeoutError' || /timed? ?out/i.test(String(err?.message || ''));
}

// { status, error } for a failed Anthropic call: busy (429, or Anthropic's 529
// "overloaded") -> 429, hung -> 504, anything else -> 500, always with a
// plain-language message. The real cause (status, error type, message) goes
// to the server log, so a generic "something went wrong" on screen can still
// be diagnosed from Vercel's Logs (never includes the request or any key).
export function aiFailure(err, { busy, failed }) {
  console.error(
    '[ai] upstream failure:',
    JSON.stringify({
      status: err?.status ?? null,
      type: err?.error?.error?.type || err?.error?.type || err?.name || null,
      message: String(err?.message || '').slice(0, 300),
    })
  );
  if (err?.status === 429 || err?.status === 529) return { status: 429, error: busy };
  if (isTimeoutError(err)) return { status: 504, error: 'That took too long. Please try again.' };
  return { status: 500, error: failed };
}
