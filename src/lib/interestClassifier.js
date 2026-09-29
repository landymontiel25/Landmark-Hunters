import { authHeaders } from './apiAuth';
import { API_BASE } from './apiBase';

const DEFAULT_EMOJI = '\u{2728}'; // sparkle -- shown until/unless the AI call succeeds

// Asks the AI which landmarks (across every city) fit a free-text custom
// interest, e.g. "nightlife" or "racing" -- topics that don't map to any of
// the app's four built-in categories -- and which single emoji best
// represents the interest itself (e.g. "racing" -> a race car), so its chip
// shows something more specific than a generic sparkle. Falls back to no
// matches and the sparkle on any failure, so a flaky/missing AI backend
// never breaks the picker.
export async function classifyInterest(interest) {
  try {
    const res = await fetch(`${API_BASE}/api/classify-interest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ interest }),
    });
    if (!res.ok) return { matches: [], emoji: DEFAULT_EMOJI };
    const data = await res.json();
    return {
      matches: Array.isArray(data.matches) ? data.matches : [],
      emoji: typeof data.emoji === 'string' && data.emoji ? data.emoji : DEFAULT_EMOJI,
    };
  } catch {
    return { matches: [], emoji: DEFAULT_EMOJI };
  }
}
