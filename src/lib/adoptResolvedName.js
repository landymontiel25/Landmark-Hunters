// Should the AI-researched full name replace what the user typed? Only when
// the typed name is a whole-word prefix of it ("Tapia" -> "Tapia Peruvian
// Restaurant"). A plain substring/char-prefix test turned "Bar" into
// "Barnes & Noble" and "Pizza" into "Joe's Pizza Palace".
export function adoptResolvedName(typedName, resolvedName) {
  const typed = String(typedName || '').trim();
  const resolved = String(resolvedName || '').trim();
  if (!resolved) return false;
  if (!typed) return true;
  const t = typed.toLowerCase();
  const r = resolved.toLowerCase();
  if (!r.startsWith(t)) return false;
  const next = r.charAt(t.length);
  return next === '' || !/[\p{L}\p{N}]/u.test(next);
}
