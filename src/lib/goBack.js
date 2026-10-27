// A Back button that still works when there's nothing to go back to (the
// page was opened straight from a link or bookmark, so navigate(-1) does
// nothing, or leaves the app). react-router marks the first entry of a
// session 'default'. `fallback` is where Back goes then (a landmark page
// opened from a shared link goes to Landmarks).
export function goBack(navigate, location, fallback = '/') {
  if (location?.key === 'default') navigate(fallback, { replace: true });
  else navigate(-1);
}
