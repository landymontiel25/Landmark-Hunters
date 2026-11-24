// Mapr's voice (owner, 2026-11-14): first person, contractions, and never a
// dash between clauses. The chat prompt asks for it; this is the safety net
// for a reply that slips: " -- ", " — " and " – " become ", ".
export function noDashes(text) {
  if (typeof text !== 'string') return text;
  return text
    // A range reads as one: "9–5" is "9 to 5", not "9, 5".
    .replace(/(\d)\s*(?:—|–|--)\s*(\d)/g, '$1 to $2')
    .replace(/\s*(?:—|–|--)\s*([.!?,;:]|$)/g, '$1')
    .replace(/\s*(?:—|–|--)\s*/g, ', ')
    .replace(/,\s*,/g, ',');
}

// Web search answers can carry the API's citation markup in their text
// (<cite index="9-1">...</cite>): never shown to the traveler.
export function noCiteTags(text) {
  return typeof text === 'string' ? text.replace(/<\/?cite\b[^>]*>/gi, '') : text;
}
