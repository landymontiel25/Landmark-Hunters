// The live Landmarks, Itinerary and Profile tabs in the sage-and-green look:
// the real screen, unchanged, inside the wrapper that apple-live.css and
// AppleScreens.css reskin, under a small date line (owner's reference app,
// 2026-11-09). The Test tab's UI lab puts the same screens under its own top
// bar.
const TODAY = () => new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });

export default function AppleSkin({ name, children }) {
  return (
    <div className={`aps aps-${name} aps-live`}>
      <div className="aps-body">
        <p className="aps-eyebrow">{TODAY()}</p>
        {children}
      </div>
    </div>
  );
}
