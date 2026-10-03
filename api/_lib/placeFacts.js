// A place's facts as one short prompt field for Mapr, so it can recommend
// from what a place is (who built it, what it serves, what it has) and not
// only its one-line summary. Imported places have thin summaries ("Park in
// Coral Gables."); their facts carry the detail. The street address is left
// out (the name and city already place it), and the text stops at a whole
// fact so the model never reads half a sentence.
export function factsText(landmark, max = 200) {
  const facts = (Array.isArray(landmark?.facts) ? landmark.facts : [])
    .map((f) => String(f ?? '').replace(/\s+/g, ' ').trim())
    .filter((f) => f && !f.startsWith('Address: '));
  let out = '';
  for (const f of facts) {
    const next = out ? `${out} ${f.replace(/[.;]?$/, '.')}` : f.replace(/[.;]?$/, '.');
    if (next.length > max) break;
    out = next;
  }
  return out;
}

// The prompt field: " | facts: ..." when there are any, else nothing.
export const factsField = (landmark, max) => {
  const t = factsText(landmark, max);
  return t ? ` | facts: ${t}` : '';
};
