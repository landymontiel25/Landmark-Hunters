// How the gallery can be ordered. The two rating sorts use the tier the
// user picked (❤️ / 😐 / 👎), put anything they haven't rated at the bottom,
// and drop dorms and other unrateable spots entirely -- there's no rating
// to sort a dorm by. Switching back to Recent / Oldest brings them back.
export const CHECKIN_SORTS = [
  { id: 'recent', label: 'Most recent' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'top', label: 'Highest rated' },
  { id: 'bottom', label: 'Lowest rated' },
  // Grouped into a fold-out section per city (CheckinsGallery), newest first inside.
  { id: 'city', label: 'By city' },
];

export function sortCheckins(items, sortId) {
  const byRecent = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
  if (sortId === 'oldest') return [...items].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (sortId === 'top' || sortId === 'bottom') {
    const dir = sortId === 'top' ? -1 : 1;
    return items
      .filter((it) => it.rateable)
      .sort((a, b) => {
        const ar = a.stars != null;
        const br = b.stars != null;
        if (ar !== br) return ar ? -1 : 1; // rated first, unrated at the bottom
        if (ar && a.stars !== b.stars) return dir * (a.stars - b.stars);
        return byRecent(a, b);
      });
  }
  return [...items].sort(byRecent);
}
