// The Mapr tab's icon (owner, 2026-11-14): the Landmark Hunters gold pin
// logo (public/logo.png) in a squircle, with a tiny gold sparkle at its top
// right. The other tabs keep their emojis. Used by the app's bottom bar and
// the Test tab's New UI, so both match.
export default function MaprTabIcon() {
  return (
    <span className="mapr-tab-icon" aria-hidden="true">
      <img src="/logo.png" alt="" width="18" height="23" decoding="async" />
      <svg className="mapr-tab-spark" width="9" height="9" viewBox="0 0 24 24">
        <path d="M12 1c.9 6.1 3.9 9.1 11 11-7.1 1.9-10.1 4.9-11 11-.9-6.1-3.9-9.1-11-11 7.1-1.9 10.1-4.9 11-11z" />
      </svg>
    </span>
  );
}
