# Place research: agent instructions (San Francisco and Silicon Valley)

You confirm places and research sourced facts for them. Use the WebSearch
tool only (page fetching is blocked). Do not use any other web tool. Work in
/home/user/Landmark-Hunters.

The audience: people who live and work in San Francisco and Silicon Valley,
tech-savvy and well-off. One wrong, closed or misplaced place hurts more than
a missing one. When in doubt, leave it out.

Your task gives you one of two inputs:

- **Seed batch** (`seed-NN.json`): named places from published lists. Each
  has `leads` (the list it came from and a URL). A lead is a hint only:
  confirm it yourself.
- **Area fill**: an area (San Francisco neighborhoods or Silicon Valley
  towns), a number of places to add, and a file of names to skip. Find
  well-documented, independent places there from local coverage (SF
  Chronicle, SF Standard, SFGate, Eater SF, The Infatuation, Hoodline,
  Mission Local, Palo Alto Online, Mercury News, Los Altos Town Crier, San
  Jose Spotlight, city park pages): restaurants, cafes, bakeries, bars,
  bookstores, galleries, venues, parks. Spread them across the area's
  neighborhoods or towns and across kinds. Skip names in the skip file and
  in the region's catalog-names.json. Prefer places open at least two
  years: they are the ones OpenStreetMap has mapped, and a place OSM lacks
  gets dropped. Restaurants, bars, cafes and shops need a street address
  with a house number from a result, or they are dropped.

Skip (do not output): chains and fast food (unless a result calls it a local
institution or it started here), hotels themselves (their public restaurants
and bars are fine), offices, schools, members-only clubs, parking, places
outside the area (San Francisco: the city only, no Treasure Island; Silicon
Valley: Palo Alto, Menlo Park, Atherton, Woodside, Portola Valley, Los Altos,
Mountain View, Sunnyvale, Cupertino, Santa Clara, downtown San Jose only).

## OpenStreetMap check first (saves searches)

A place counts only if OpenStreetMap has it. Before any web search on a
place, check it (Bash, from /home/user/Landmark-Hunters; up to 15 names per
call; it waits for its turn, so a call can take a while):

    node scripts/osm-import/osm-check.mjs --region sf "Name One" "Name Two"

(`--region sv` for Silicon Valley.) It prints each name's OSM matches with
kind and street, or NOT IN OSM. Research only names with a match; try one
other spelling the place goes by before giving up on it. Do not output
places NOT IN OSM (seed batches: output them with `notInOsm: true`, no
searches). The OSM street shown is a hint for your search; the address you
output must still come from a web result. If the web address and the OSM
street disagree, the place may have moved: check that it is open there.

## Per place

- Up to 4 searches, each a different query; most places need 1 or 2. The
  session has a shared search cap, so average under 2 per place. Start with
  name + street or neighborhood + city ("Zuni Cafe Market Street San
  Francisco").
- Confirm it is this place and that it is open now: same name AND same
  street or neighborhood. A result says it closed for good, closed "for now"
  with no reopening date, moved out of the area, or is only coming soon:
  closed: true, closedSource: that URL, no facts.
- address: the street address with house number ("1658 Market St"), from a
  result. Parks and landmarks without a number: the street or cross streets a
  result gives ("Bernal Heights Blvd"). Never guess a number.
- 2 to 4 facts, each one plain sentence of at most 120 characters, each with
  the URL of the result that states it.
- Source rule: keep a fact only when one link's title or snippet states it,
  the summary cites that link, or the result came back from a search with
  allowed_domains set to one domain and returned one page about this place.
  Never pick "the most likely" link among several. When you can't tell which
  link states a fact, run a domain-limited search (the place's own site, the
  Michelin guide, a news site) and keep the fact only if that result states it.
- Good facts: opening year, founders or chef and their background, what it
  specializes in (signature dishes, style, house-made products), the
  building's history, what the name honors, features (garden patio, roof
  deck, trails), awards with their year ("Holds one Michelin star in the 2026
  MICHELIN Guide California.", "Named a Bib Gourmand by the MICHELIN Guide in
  2025.", "Named to the San Francisco Chronicle's Top 100 Restaurants in
  2026.", "Won the 2024 James Beard Award for Outstanding Bakery.").
- Tech or founder connection (tier "insider"): only when a result states it
  (a deal, a famous meeting, founders' regular spot, built by or named for a
  tech figure). Put it in `reason` {text, url} as one plain sentence, and
  also as one of the facts.
- Never: prices, hours, phone numbers, star ratings, review counts, opinion
  words (best, famous, popular, iconic, favorite, beloved, delicious,
  stunning, must-try, cozy, amazing, legendary, renowned, acclaimed,
  celebrated, hidden gem), "coming soon", anything inferred or from memory.
  No em dashes. Do not restate the street address as a fact. A Michelin star
  is an award, so "Michelin star" is fine; "4.5 stars" is not.
- Every award fact states its year ("in 2013"); an award without a year
  from the result stays out. A place with only 1 fact after its first
  search gets a second search: places with fewer than 2 facts are dropped.
- tier: "acclaimed" only for an award or list from 2025 or 2026; older
  awards are fine as facts (with their year) but the tier stays "everyday".
  "acclaimed" when a fact you kept is an award or a critics' list
  (Michelin, James Beard, Chronicle Top 100, World's/North America's 50 Best,
  Eater essential); "insider" when `reason` is set; else "everyday".
- No confirming result after 4 searches: notFound: true, no facts. A place
  with fewer than 2 sourced facts after 4 searches: keep it with the facts
  you have; it may be dropped later.

## Output

Write the JSON array to the out file your task names, rewriting the whole
array after every 5 places so progress survives an interruption. One entry
per place you looked at (seed batches: one per seed, in input order):

    {"name", "area", "address", "city", "tier", "matched", "closed",
     "closedSource", "notFound", "searches", "reason", "facts": [{"text", "url"}]}

- name: the place's name as its own site or the result writes it.
- area: San Francisco neighborhood or Silicon Valley town.
- city: "San Francisco", or the town ("San Jose" for downtown San Jose).
- reason: {text, url} or null.

When done, reply with one line: places with 2+ facts, closed, notFound,
skipped, searches used.
