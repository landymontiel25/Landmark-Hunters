// "2 h 15 min" / "45 min": the time a trip's stops take, from each place's
// typical visit length.
export function fmtVisitMinutes(total) {
  const m = Math.round(total || 0);
  if (m <= 0) return '';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
}
// "Brickell Park, Alhambra Plaza +2" -- the first few places on a trip.
export function placeSummary(names, shown = 3) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return '';
  return list.slice(0, shown).join(', ') + (list.length > shown ? ` +${list.length - shown}` : '');
}
