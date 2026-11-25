// How a notification row reads (Notifications.jsx): pure, no Firebase.

// When a notice came, said plainly: "just now", "5m", "3h", "2d", or a date.
export function noticeAge(n, now = Date.now()) {
  const ms = n?.createdAt?.toMillis?.() ?? (Number.isFinite(n?.createdAt?.seconds) ? n.createdAt.seconds * 1000 : Number(n?.createdAtMs) || null);
  if (!ms) return '';
  const m = Math.floor((now - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d` : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// The icon a notice shows: its own leading emoji when the message starts
// with one (taken off the text), else one for its kind.
const KIND_ICON = {
  streak_warning: '\u{1F525}',
  group_invite: '\u{1F3AB}',
  rating_tag: '\u{1F3F7}\u{FE0F}',
  offline_checkin_paid: '\u{1F4CD}',
  admin_test: '\u{1F514}',
  mapr_project_invite: '\u{1F4C1}',
  onboarding_update: '\u{1F9ED}',
};
const LEADING_EMOJI = /^\s*((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\u{FE0F}|\u{200D}|\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*/u;
export function noticeParts(n) {
  const msg = String(n?.message || '');
  const m = LEADING_EMOJI.exec(msg);
  const kind = String(n?.type || '');
  const icon = m ? m[1] : KIND_ICON[kind] || (kind.startsWith('discovery_') ? '\u{2728}' : kind.startsWith('friend') ? '\u{1F465}' : '\u{1F514}');
  return { icon, text: m ? msg.slice(m[0].length) : msg };
}

