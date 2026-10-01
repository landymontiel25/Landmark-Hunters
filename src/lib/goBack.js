// A Back button that still works when there's nothing to go back to (the
// page was opened straight from a link or bookmark, so navigate(-1) does
// nothing). react-router marks the first entry of a session 'default'.
export function goBack(navigate, location) {
  if (location?.key === 'default') navigate('/', { replace: true });
  else navigate(-1);
}
