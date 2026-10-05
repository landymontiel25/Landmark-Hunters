# San Francisco research: agent instructions (one batch)

You research facts for imported San Francisco places (restaurants, cafes,
bakeries, bars, museums, galleries, theaters, music venues, parks, beaches,
historic sites, markets, bookstores). The app is shown to people who live in
San Francisco, so every place must be real and still open at this spot, and
every fact must be true and sourced. Use the WebSearch tool only (page
fetching is blocked). Do not use any other web tool and nothing from memory.
Work in /home/user/Landmark-Hunters.

Input: scripts/osm-import/research/sf/batch-NN.json. Each place has id, name,
category, kind, summary, address (may be null), neighborhood (the nearest
neighborhood center, a hint only), lat/lng, website and knownFacts (lines
already shown in the app from OpenStreetMap and Wikidata; do not repeat them).

## Per place

- Up to 4 searches, each with a different query. Stop once you have 3 to 5
  confirmed facts (2 is fine for a small cafe or bar after 4 searches).
  Suggested order:
  1. name + street (or neighborhood) + "San Francisco"
  2. name + "San Francisco" + "history" / "opened" / "about" / "menu"
  3. name + San Francisco + yelp / sfgate / eater / instagram
  4. allowed_domains set to one domain: the place's own website, sf.gov or
     sfrecpark.org for city parks, nps.gov for the Presidio and Golden Gate
     National Recreation Area, or a news site whose result title is about
     this place.
- Confirm it is this place: same name AND same street, neighborhood or
  park in San Francisco. A same-name place in another city (Oakland,
  Daly City, Berkeley...) or another SF neighborhood does not count.
  Places without an address: a same-name place within about 400 m.
- Open check: a result says it closed for good (permanently closed, shut
  down, last day, replaced by another business, moved to another address):
  closed: true, closedSource: that URL, no facts. The closedSource page must
  name this place (a page for a new business at the address counts only when
  its title or snippet says it replaced this place). Temporarily closed for
  renovation is not closed. If results disagree, the newest dated result wins;
  say which in a "note" field.
- After 4 searches nothing confirms this place exists at this spot:
  matched: false, notFound: true, no facts (searches must be 4).
- Each fact: one plain sentence, at most 120 characters, with the URL of the
  result that states it. Source rule: keep a fact only when one link's title
  or snippet states it, the summary cites that link, or exactly one returned
  link is a page about this place. Never pick "the most likely" link among
  several. If no single link states it, leave the fact out.
- WebSearch often answers with a summary plus a list of links and no
  per-link snippets. Then you may not guess which link said what: run the
  next search with allowed_domains set to one domain (the place's own site
  first) so a page about this place comes back alone, and cite that page.
  A fact you cannot tie to one page this way is left out.
- Cite the original page, never a proxy or translation URL
  (translate.goog, AMP caches, Google redirect links).
- Good facts: opening or build year, founder, chef, owner or operator,
  architect, what the name honors, what it specializes in (signature dishes,
  cuisine style, house-made products, beer styles brewed on site), what kind
  of place it is (family-owned, counter service, food hall stall, dive bar,
  jazz club), history and notable events, park features (trails, playground,
  courts, dog play area, size in acres), named awards with year (James Beard,
  Michelin star with year, Legacy Business Registry with year).
- Never: prices, hours, phone numbers, ratings, review counts, rankings or
  "top 10" lists, opinion words (best, famous, popular, iconic, favorite,
  beloved, delicious, stunning, must-try, cozy, amazing, legendary, hidden
  gem), "known for" claims, "oldest/only/first" unless the source states it as
  a plain fact about this place, "coming soon", anything inferred or from
  memory. No em dashes. Do not restate the street address. Do not start with
  "Serves" when knownFacts already has a "Serves" line; write a more specific
  fact instead ("Makes its tortillas by hand in house.").
- Write in plain present or past tense, with the place as the implied
  subject ("Opened in 1919 by ..."), no marketing tone. Skip slogans and
  self-descriptions ("Describes itself as ..."); state what the place has or
  does instead ("A lesbian-owned bar."). No list placements (Esquire's best
  bars, top-50 lists); a named award with its year is fine.
- Matching a closure: with an address, the closure page must name this place
  at this address. Without one, it must name this place in the neighborhood
  given (check lat/lng); put the address the page shows in "note".

## Output

Write scripts/osm-import/research/sf/out-NN.json as a JSON array, one entry
per input place, in input order:
  {"id", "name", "matched", "closed", "closedSource", "notFound", "searches", "note", "facts": [{"text", "url"}]}
(searches = number of searches used; note may be null). Write the file after
every 5 places so progress survives an interruption (rewrite the whole array
each time); this is required, not optional. When done, reply with one line: counts of places with facts,
closed, notFound.
