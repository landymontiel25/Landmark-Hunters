// Moves one item of a list to a new position and returns a new list. Used by
// Admin Mode's photo-order editor. Out-of-range or no-op moves return the
// list unchanged.
export function moveImage(images, from, to) {
  if (!Array.isArray(images)) return [];
  if (from === to || from < 0 || to < 0 || from >= images.length || to >= images.length) return images;
  const next = [...images];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
