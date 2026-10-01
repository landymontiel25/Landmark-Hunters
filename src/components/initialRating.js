// Chips and loved/disliked picks are tier-specific, so a different pre-picked
// tier keeps only the free-text comment and visit frequency.
export function initialRating(existing, initialTier) {
  // A comment-only doc (written from "Add a comment", no rating yet) still has
  // a comment on file: dropping it here made the rating form submit an empty
  // one, which blanked the saved comment the moment the rating was saved.
  if (!existing?.ratingTier) {
    const comment = existing?.comment;
    if (initialTier) return comment ? { tier: initialTier, comment } : { tier: initialTier };
    return comment ? { comment } : null;
  }
  if (!initialTier || initialTier === existing.ratingTier) return { ...existing, tier: existing.ratingTier };
  return { tier: initialTier, comment: existing.comment, visitFrequency: existing.visitFrequency };
}
