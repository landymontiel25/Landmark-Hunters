# Mapr chat facts: 30,000 travelers, 90,000 questions

Run of October 13, 2026, 6:51-7:34 PM ET (43 minutes, one core). Command:

```bash
MAPR_CHAT_SIM_USERS=30000 MAPR_CHAT_SIM_OUT=mapr-synthetic-trainer/output-chat \
  npx vitest run mapr-synthetic-trainer/chat-facts
```

Data: `output-chat/chat-sim-30000.json`. The normal test suite runs the same
simulation with 300 travelers and fails if one wrong fact reaches a
traveler.

## Why

Mapr told the owner Kres Chophouse was about 7 miles from House of Blues
Orlando. Google Maps says 14. The owner had planned around Mapr's number.
Mapr chat must never state a fact it didn't check.

## How it works

- **Travelers.** 30,000 synthetic travelers in 9 cities (Miami, Philly,
  Villanova, SF, Silicon Valley, NYC, Paris, Madrid, Milan), 80% with
  location on, a random time of day. Each asks 3 questions in one chat.
- **Questions.** 11 kinds, 120 wordings, with typos and texting style
  ("hw long is the drive", "yo is X open", "pls"): distance between two
  places, distance from me, walking, hours, prices, ratings, planning a
  day, "near me" picks, directions, app how-tos, and visit-length questions
  that sound like travel but aren't ("how long should I spend at X").
  Place names are real ones from the app's catalog.
- **The AI.** A stand-in (`chat-facts/fake-model.js`) that misbehaves on
  purpose. 55% of answers are careful (uses the right lookup, reports it
  exactly), 30% sloppy (uses lookups half the time, garbles numbers half
  the time: km read as miles, halved times, rounding), 15% liars (never
  look anything up, invent every number).
- **The world.** A fake Google (`chat-facts/world.js`) places every catalog
  name at its real coordinates and gives every place fixed hours, a price
  and a rating, so the grader knows the true answer to every question.
- **The code under test.** The real `api/plan-ai.js` handler, end to end:
  question detection, forced lookups, the tool loop, the recheck round, the
  fact guard, the two-sentence trim and address linking.
- **The grader** (`chat-facts/grade.js`) reads every distance, travel
  time, clock time, "open now", price and star rating in the reply the
  traveler sees and checks it against the truth.

## Results

| | Count |
|---|---|
| Questions asked | 90,000 |
| Replies where the AI wrote at least one wrong fact | 20,952 (23%) |
| Wrong facts the AI wrote | 28,283 |
| **Wrong facts shown to a traveler** | **0** |
| Distance questions left with no real answer and no "couldn't check" | 0 |
| Server errors | 0 |
| True facts cut by mistake | 32 (all in day plans, 0.04%) |

By kind of question:

| Question | Asked | Replies the AI got wrong | Shown wrong | Lookup forced first |
|---|---|---|---|---|
| Distance between two places | 14,323 | 3,483 | 0 | 99.1% |
| Distance from me | 14,502 | 4,474 | 0 | 99.1% |
| Walking | 6,209 | 1,850 | 0 | 99.2% |
| Hours | 10,827 | 2,977 | 0 | 90.2% |
| Plan a day | 10,773 | 2,318 | 0 | (AI calls best_order) |
| "Near me" picks | 10,780 | 2,335 | 0 | none needed |
| Prices | 5,425 | 1,578 | 0 | none needed |
| Ratings | 4,586 | 1,289 | 0 | none needed |
| Directions | 4,595 | 645 | 0 | none needed |
| App how-tos | 3,534 | 0 | 0 | 0 (correct) |
| Visit length ("how long should I spend") | 4,446 | 3 | 0 | 0.3% (should be 0) |

The careful AI never wrote a wrong fact; the sloppy one did in 34% of
replies, the liar in 88%. In every case the traveler saw only checked
numbers, the real number from Google Maps, or "I couldn't check".

## Bugs the simulation found (all fixed)

1. **Guesses went straight to the traveler.** The instructions said "don't
   guess", but nothing enforced it. Fix: `api/_lib/factGuard.js` cuts any
   distance, travel time, hours, price or rating that no lookup in that
   reply backs.
2. **An instruction told Mapr to guess.** "Mention roughly how far each
   stop is" sat in the location rule. Removed; the cards already show real
   distances.
3. **Typos skipped the lookup.** "hw long is the drive" wasn't seen as a
   distance question. Detection rewritten (`asksDistanceOrTime`).
4. **False alarms forced lookups.** "How long does it take to set up a
   trip" and "I have 2 hours to kill" forced a route lookup. "How long" now
   needs a travel word.
5. **"14.6 miles" read as "6 miles".** The number parser started at the
   decimal point, and the sentence splitter dropped everything before it.
6. **"1 hr 24 min" read as two numbers**, so a correct time looked wrong.
7. **"8 minutes on foot" wasn't a travel time.** Added "on foot".
8. **Hours were trusted if any lookup happened.** Now each time must match
   the place_hours result, and "open now" must match too.
9. **A cut guess left "Here's what I found:".** Now a reply that states an
   unchecked distance or hours goes back to the AI once with the lookup
   required, and a distance question always ends with a checked number or
   an honest "couldn't check" ("turn on location" when that's the cause).
10. **Names with initials broke replies.** "F. M. Kirby Auditorium is 2.3
    miles away" was split at "F." and "M.", and the two-sentence trim kept
    only "F. M.". Initials now stay whole.

## New: things Mapr can do for your day

- **Live hours** (`place_hours`, Google Places): "is X open", "what time
  does X close" check Google first; Mapr checks a stop is open before
  sending you there tonight.
- **Fastest order** (`best_order`, Google Route Matrix): "plan my
  afternoon: A, B and C" tries every order (up to 7 stops) and gives the
  fastest with each leg and the total; with a time budget it says whether
  it fits and what to cut.

## Limits

- The AI here is a stand-in that fails on purpose. It shows the code stops
  every wrong number it was given; it doesn't measure how often the real
  model is wrong. A live run against the real model needs a dollar budget
  from the owner.
- Hours from web search are trusted, not checked number by number.
- 9.8% of hours questions and 0.9% of distance questions aren't spotted by
  the detector. The guard and the recheck round still cover them (0 shown
  wrong), at the cost of one extra AI call.
- 32 true day-plan facts were cut; none wrong was shown.
