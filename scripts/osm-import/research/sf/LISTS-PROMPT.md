# Candidate lists: agent instructions (San Francisco and Silicon Valley)

You collect candidate places from published, sourced lists. Use the WebSearch
tool only (page fetching is blocked). Do not use any other web tool. Work in
/home/user/Landmark-Hunters.

The audience: people who live and work in San Francisco and Silicon Valley,
tech-savvy and well-off. The app shows them places worth going to.

## Rules

- Only names that a search result states belongs to the list or fact you
  record. Nothing from memory, nothing inferred.
- Each row needs the URL of the result that names the place for that list.
  The summary of a search often blends sources: keep a row only when one
  link's title or snippet names the place, the summary cites that link, or
  the result came back from a domain-limited search (allowed_domains) that
  returned one page.
- Skip: chains and fast food, hotels themselves (their public restaurants and
  bars are fine), offices, schools, members-only clubs, parking, places a
  result says closed, moved out of the area, or are only "coming soon".
- Skip any place in the region's catalog-names.json file (already in the
  app), and any place outside the area your task names.
- Use at most the number of searches your task gives. Prefer searches that
  return whole lists (the guide's own page, a news article listing winners).

## Output

Write the JSON array to the file your task names, rewriting it after every
few searches so progress survives an interruption. One row per place:

    {"name", "area", "address", "list", "year", "sourceUrl", "note"}

- area: the neighborhood (San Francisco) or town (Silicon Valley) the result
  states, else null.
- address: street address when a result states it, else null.
- list: short list name ("Michelin star", "Michelin Bib Gourmand", "SF
  Chronicle Top 100", "Eater SF essential", "Eater SF cocktail bars"...).
- year: the list's year when stated, else null.
- note: for tech or founder places only, one plain sentence of what the
  result says about the tech connection, else null.

When done, reply with one line: rows written and searches used.
