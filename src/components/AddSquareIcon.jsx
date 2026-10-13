// The "add a user" icon on an itinerary's Members card: a rounded square
// with a plus in it, drawn in the text color.
export default function AddSquareIcon() {
  return (
    <svg className="member-add-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.5" width="19" height="19" rx="6" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 7.5v9M7.5 12h9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
