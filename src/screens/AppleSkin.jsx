// The live Landmarks, Itinerary and Profile tabs in the Apple Maps look: the
// real screen, unchanged, inside the wrapper that apple-live.css and
// AppleScreens.css reskin. (The Test tab's UI lab puts the same screens under
// its own top bar.)
export default function AppleSkin({ name, children }) {
  return (
    <div className={`aps aps-${name} aps-live`}>
      <div className="aps-body">{children}</div>
    </div>
  );
}
