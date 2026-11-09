// A Profile list card: each row is a tappable line with a gold icon, a label,
// an optional detail on the right and a chevron (owner's mockup, 2026-11-09).
const ICONS = {
  memories: <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" />,
  stats: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  today: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <path d="m9.3 10 2 2 3.4-3.6" />
    </>
  ),
  ranks: <path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1.5A3 3 0 0 0 7 10.5M17 6h3v1.5a3 3 0 0 1-3 3M12 14v4M8.5 20h7" />,
  leaderboard: <path d="M4 20v-7h4v7M10 20V5h4v15M16 20v-10h4v10M3 20h18" />,
  friends: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c.6-3.4 3-5 6-5s5.4 1.6 6 5M16 5.2a3.2 3.2 0 0 1 0 5.6M18 15.2c1.8.7 3 2.2 3.3 4.8" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.6M12 18.9v2.6M4.6 5.6l1.9 1.9M17.5 16.5l1.9 1.9M2.5 12h2.6M18.9 12h2.6M4.6 18.4l1.9-1.9M17.5 7.5l1.9-1.9" />
    </>
  ),
  signout: <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />,
};

export default function ProfileList({ items, label }) {
  return (
    <div className="pf-list" role="list" aria-label={label}>
      {items.map((it) => (
        <button key={it.id} type="button" role="listitem" className="pf-row" disabled={it.disabled} onClick={it.onClick}>
          <svg className="pf-row-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICONS[it.icon]}
          </svg>
          <span className="pf-row-label">{it.label}</span>
          {it.detail != null && it.detail !== '' && <span className="pf-row-detail">{it.detail}</span>}
          <svg className="pf-row-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      ))}
    </div>
  );
}
