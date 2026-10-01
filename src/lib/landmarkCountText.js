// The subtitle on Choose Landmarks. "All N" is only true when nothing is
// narrowing the list, and the count must read right at 0 and 1.
export function landmarkCountText({ count, matchingInterests = false, searching = false, cityFiltered = false }) {
  const noun = count === 1 ? 'landmark' : 'landmarks';
  if (count === 0) {
    if (matchingInterests || searching || cityFiltered) {
      return 'No landmarks match right now — try clearing the search or a filter.';
    }
    return 'No landmarks to show yet.';
  }
  const pick = count === 1 ? 'pick it if you want to see it' : 'pick what you want to see';
  if (matchingInterests) return `${count} ${noun} matching your interests — ${pick}.`;
  if (searching || cityFiltered) return `${count} ${noun} shown — ${pick}.`;
  return count === 1 ? 'Just 1 landmark — pick it if you want to see it.' : `All ${count} landmarks — pick everything you want to see.`;
}
