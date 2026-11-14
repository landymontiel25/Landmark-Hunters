// Mapr's voice (owner, 2026-11-14): first person, contractions, and never a
// dash between clauses. The chat prompt asks for it; this is the safety net
// for a reply that slips: " -- ", " — " and " – " become ", ".
export function noDashes(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\s*(?:—|–|--)\s*([.!?,;:]|$)/g, '$1')
    .replace(/\s*(?:—|–|--)\s*/g, ', ')
    .replace(/,\s*,/g, ',');
}
