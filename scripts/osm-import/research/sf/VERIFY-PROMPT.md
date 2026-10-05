# Second pass: fact verification (San Francisco and Silicon Valley)

You check facts another agent researched. Use the WebSearch tool only (page
fetching is blocked). Work in /home/user/Landmark-Hunters. You did not write
these facts; assume nothing about them.

Input: `verify-NN.json`, places with id, name, address, city and facts
[{text, url}].

## Per place

- First, is it still open at this address? One search, name + street +
  city. A result says it closed for good, closed with no reopening date, or
  moved away: `closed: true` and `closedSource`.
- Then each fact: run a search with `allowed_domains` set to the domain of
  the fact's url and a query made of the place's name plus the fact's key
  words. The fact is `ok` only when a returned result is that url (or the
  same page) and its title or snippet, or the summary citing it, states the
  fact. `wrong` when a result states something different (another year,
  another founder, another place). `unsupported` when nothing returned
  states it. One search per fact, at most 5 searches per place.
- Do not fix or rewrite facts. Do not add facts.

## Output

Write `verify-out-NN.json` (same folder as the input), rewriting it after
every 5 places:

    [{"id", "name", "closed", "closedSource",
      "facts": [{"text", "url", "verdict": "ok" | "wrong" | "unsupported", "note"}]}]

When done, reply with one line: facts ok / wrong / unsupported, closed
places, searches used.
