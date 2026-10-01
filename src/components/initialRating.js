// Chips and loved/disliked picks are tier-specific, so a different pre-picked
// tier keeps only the free-text comment and visit frequency.
export function initialRating(existing, initialTier) {
  if (!existing?.ratingTier) return initialTier ? { tier: initialTier } : null;
  if (!initialTier || initialTier === existing.ratingTier) return { ...existing, tier: existing.ratingTier };
  return { tier: initialTier, comment: existing.comment, visitFrequency: existing.visitFrequency };
}
