// A phone-sized box for previewing a screen inside another screen. It
// stands in typical iPhone safe-area insets (--mpp-safe-top/-bottom), which
// the sheet and overlays read; outside a PhoneFrame those same variables
// fall back to the device's real env(safe-area-inset-*).
export default function PhoneFrame({ children, label = 'Phone preview' }) {
  return (
    <div className="mpp-phone" role="group" aria-label={label}>
      <div className="mpp-phone-screen">{children}</div>
    </div>
  );
}
