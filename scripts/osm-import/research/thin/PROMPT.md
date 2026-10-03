# Thin-place research: agent instructions (one batch)

You research facts for small imported places (restaurants, cafes, bakeries,
bars, shops, small parks) in Miami, Philadelphia and Villanova/Main Line PA.
Use the WebSearch tool only (page fetching is blocked). Do not use any other
web tool. Work in /home/user/Landmark-Hunters.

Input: scripts/osm-import/research/thin/batch-NN.json. Each place has id, name,
region, category, kind, summary, address (may be null), lat/lng, website and
knownFacts (generic lines already shown in the app; do not repeat them).
When address is null, use lat/lng and summary to work out the neighborhood or
town (Miami area: Miami, Miami Beach, Coral Gables, Doral...; philly region:
Philadelphia neighborhoods plus suburbs like Bryn Mawr, Ardmore, Conshohocken;
villanova region: Villanova, Rosemont, Bryn Mawr, Wayne, Radnor).

## Per place

- Up to 4 searches, each with a different query. Stop once you have 2 to 4
  confirmed facts. Suggested order:
  1. name + street + city
  2. name + neighborhood/town + "menu" or "about"
  3. name + town + yelp / instagram / facebook
  4. parks: name + city + "parks" (city parks department); others: name +
     town with allowed_domains set to one domain (the place's own website, or
     a news site whose result title is about this place).
- Attribution: when a search returns a summary plus several links and you
  cannot tell which link states a fact, run the next search with
  allowed_domains set to that one domain (the place's own site first). A
  fact counts only when that domain-limited result states it. Budget: the
  session has a shared search cap, so average about 3 searches per place.
- Chains (IHOP, Denny's, Starbucks, Fogo de Chao...): facts about this branch
  (when it opened, which mall, food hall or terminal it is in) or, failing
  that, one or two facts about the chain itself from the chain's own site
  (founded where and when, what it is known for), worded as "Part of X,
  founded in ...".
- Confirm it is this place: same name AND same street, neighborhood, town or
  park. A same-name place elsewhere does not count. Places without an
  address: a same-name place within about 600 m in the same neighborhood counts.
- Each fact: one plain sentence, at most 120 characters, with the URL of the
  result that states it. Source rule: keep a fact only when one link's title
  or snippet states it, the summary cites that link, or exactly one returned
  link is a page about this place. Never pick "the most likely" link.
- Good facts for small places: what it specializes in (signature items,
  cuisine style, house-made products), who owns or founded it and when, what
  kind of place it is (family-owned, food hall stall, counter service,
  BYOB), park features (playground, courts, trails, dog park, size in acres),
  history of the name. Menu, delivery and Yelp pages may be used for what a
  place serves or offers, never for ratings.
- Never: prices, hours, phone numbers, ratings, review counts, rankings,
  awards lists like "top 10", opinion words (best, famous, popular, iconic,
  favorite, beloved, delicious, stunning, must-try, cozy, amazing), "coming
  soon", anything inferred or from memory. No em dashes. Do not restate the
  street address. Facts must not start with the generic words in knownFacts
  ("Serves ...", "Has outdoor seating" ...); write specific facts instead,
  e.g. "Bakes Italian rolls and tomato pie on site." rather than "Serves bread."
- A result says it closed for good (permanently closed, shut down, replaced
  by another business): closed: true, closedSource: that URL, no facts.
- After 4 searches nothing confirms this place exists: matched: false,
  notFound: true, no facts. notFound needs all 4 searches used (searches: 4);
  fewer is not allowed. A matched place with fewer than 2 facts also keeps
  searching until 4 searches are used.
- The closedSource page must name this place at this address (a page for a
  different business at the same address is fine only when its title or
  snippet says it replaced this place).
- No fact may rest on "the most obvious page". If no single link states it,
  leave it out.

## Output

Write scripts/osm-import/research/thin/out-NN.json as a JSON array, one entry
per input place, in input order:
  {"id", "name", "matched", "closed", "closedSource", "notFound", "searches", "facts": [{"text", "url"}]}
(searches = number of searches used). Write the file after every 5 places so
progress survives an interruption (rewrite the whole array each time). When
done, reply with one line: counts of places with facts, closed, notFound.
