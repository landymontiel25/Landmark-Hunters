// Leaderboard period keys ("2026-W41", "2026-10", "2026"), pure, so the app
// and the API compute them the same way. `offsetMin` is the viewer's
// Date#getTimezoneOffset(): periods follow the viewer's own calendar.
const pad = (n) => String(n).padStart(2, '0');

export function periodKeysAt(ms, offsetMin = 0) {
  const d = new Date(ms - offsetMin * 60000);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
  return {
    weekly: `${day.getUTCFullYear()}-W${pad(weekNo)}`,
    monthly: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`,
    yearly: `${d.getUTCFullYear()}`,
  };
}
