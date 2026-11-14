# Landmark Hunters design language

Read this before building or restyling any screen. It sets the colors, type,
spacing, corners, motion and voice for every screen. The reference build is
the Test tab's **New UI** sub-tab (`src/screens/NewUILab.jsx`,
`src/screens/NewUILab.css`): the full tab bar with Map, Landmarks, Itinerary
and Profile redesigned (Mapr stays as it is). Copy its tokens and parts rather
than inventing new ones.

**In one line:** Quiet is the base (a travel planner), and Mapr is the
Character inside it. Pure white, Inter, and gold is the only accent. Mapr is a
personal guide who walks with you, not a pet and not a magic button.

---

## 1. Where this comes from (AppMonkey, 2026-11-14)

The top-earning travel planning apps on the US App Store, by AppMonkey's
estimated monthly store revenue (AppMonkey's own figures, not
publisher-reported), and what their first three store screenshots show.
These are the screenshots each company chose for its store page, not screens
captured inside the apps.

| App | Revenue / month | Downloads / month | Genre |
| --- | --- | --- | --- |
| Expedia | ~$12M | ~6.2M | **Loud** |
| Skyscanner | ~$7.5M | ~3.7M | **Data** (sold Loud) |
| TripIt | ~$900K | ~450K | **Data** |
| Polarsteps | ~$770K | ~360K | **Atmosphere** |
| Wanderlog | ~$750K | ~330K | **Quiet** (with a Character voice) |
| Airbnb (no store revenue; books on its own site) | n/a | ~2.5M | **Quiet** |

What each one does:

- **Expedia (Loud).** Warm off-white page, navy serif headlines, a yellow
  highlighter swipe behind the key words ("save up to 30%"), a blue Search
  button, green "45% less than typical" deal badges, prices in big bold
  numbers. Square-ish cards (about 12 pt corners), outlined form fields. Talks
  in deals: "Your one-stop travel shop", "Bundle & Save $277".
- **Skyscanner (Data, sold Loud).** One flat saturated blue covers everything,
  white rounded-sans headlines, a price under every date in the calendar,
  month tiles. Talks in superlatives about price: "Find the cheapest day to
  fly".
- **TripIt (Data).** Corporate blue, a vertical timeline of flights, cars and
  hotels with confirmation numbers and seat numbers, green "On Time" chips,
  press logos and "4.8 Stars". Talks in tasks: "Organize your trip".
- **Polarsteps (Atmosphere).** Satellite maps at night, glowing white route
  lines, photo bubbles on the route, a coral-red ribbon, dark glass controls,
  small spaced-uppercase kicker ("PLAN YOUR JOURNEY") over a heavy headline.
  Talks in feelings: "Plan, track, and relive your travels".
- **Wanderlog (Quiet, Character voice).** Full-bleed coral, red and indigo
  panels outside, but inside it is a white document: bold section headings,
  numbered pins, collapsible lists, a stack of round floating buttons
  (gradient magic wand for AI, map, plus). The copy is playful ("Fooood 🤤").
- **Airbnb (Quiet).** Warm off-white, black text, big photo cards with about
  20 pt corners, small white "Guest favorite" pills on the photo, a heart,
  `★ 4.92` under every listing, 3D illustrated icons for Homes, Experiences,
  Services. Talks short and warm: "Book great homes around the world".

### Rules the winners share

- **Colors.** One loud brand color does the heavy lifting (blue x3, coral,
  yellow). Green means a good deal or "on time". Pages behind the phone are
  either flooded with the brand color or a warm off-white.
- **Type.** One sans family inside the app (Expedia adds a serif only for
  marketing). Big, heavy headlines of 2 to 5 words; body text at 15 to 17 pt;
  dense metadata lines in gray ("2 beds · ★ 4.93").
- **Spacing.** A 16 pt side gutter everywhere. Sections are separated by
  space or a thin gray band, never boxes inside boxes. Lists are dense.
- **Corners.** Cards and photos 12 to 20 pt; buttons and filters are full
  pills; sheets have big top corners (20 pt+) over a map.
- **Motion** (seen in the layouts, not in motion). Bottom sheets over maps,
  horizontal photo rows, cards that lift out of a list with a shadow. Nothing
  moves for its own sake.
- **Voice.** Imperative and short: Find, Book, Organize, Plan, Discover. The
  app speaks as a store or a tool. Proof is borrowed: ratings, review counts,
  press logos, "App of the Day".

### The gap: what they all do the same that we do differently

1. **They flood the screen with brand color; we stay white.** Every winner
   leads with a saturated field (blue, coral, yellow). A pure white page with
   one thin line of gold is the thing nobody in the top tier looks like.
2. **They lead with a crowd score; we lead with a reason.** Every place card
   carries ★ 4.92, "9.4 Exceptional" or "Guest favorite". We never show
   ratings, prices, hours or opinion words (best, famous, iconic). Each place
   gets one line on why it is for *you* ("Because you liked Vizcaya"), and
   every fact names its source.
3. **Their AI is a button; ours is a guide.** Wanderlog's AI is a gradient
   magic wand; Polarsteps sells an "AI-powered itinerary planner". Neither has
   a name or a voice. Mapr has a name, speaks in the first person, and shows
   up at the moment of a decision with one short line.
4. **Their trip ends at the booking; ours ends at the place.** Expedia,
   Skyscanner and TripIt stop at a confirmation number. Polarsteps tracks the
   route. Landmark Hunters is about getting there and checking in, so progress
   (found, checked in) is part of the plan, shown in gold.
5. **Their photos are covered in stickers; ours stay clean.** Hearts, badges
   and price pills sit on top of every photo. Our photos carry only the place
   name, in white on a dark gradient, and nothing else.

---

## 2. Genre

- **Base: Quiet.** White page, black text, gray for secondary text, hairline
  dividers, generous space. The app gets out of the way of the places.
- **Inside it: Character (Mapr).** Mapr is the only thing on screen with a
  personality. It has a mark (the gold four-point spark), a voice, and the
  only idle motion in the app.
- **Not:** Loud (no deal badges, no exclamation marks, no highlighter), Data
  (no dense numbers, no ratings), Atmosphere (no night satellite maps, no
  glow). Photos give the places their atmosphere; the UI does not add any.

---

## 3. Color

Gold is the only accent. Everything else is white, black and neutral gray.
No cream, no beige, no warm off-white (owner, 2026-11-09). No blue, green,
coral or purple in new screens. Map pins and the existing Mapr tab are the
only places older colors remain.

### Light (the base)

| Token | Value | Use |
| --- | --- | --- |
| `--nui-bg` | `#FFFFFF` | Page. Pure white, always. |
| `--nui-surface` | `#F5F5F5` | Search field, segmented control, quiet chips. |
| `--nui-line` | `#EBEBEB` | Hairline dividers and card borders (1 px). |
| `--nui-text` | `#0A0A0A` | Titles and body. |
| `--nui-text-2` | `#6B6B6B` | Secondary lines, metadata. |
| `--nui-text-3` | `#767676` | Labels, placeholders (4.5:1 on white). |
| `--nui-gold` | `#C9971A` | Fills, the Mapr mark, progress, icons, large text. |
| `--nui-gold-text` | `#8A6512` | Gold text under 18 pt (reads at 5:1 on white). |
| `--nui-gold-ink` | `#1A1300` | Text on a gold fill. |
| `--nui-gold-soft` | `rgba(201,151,26,0.12)` | Selected chip, Mapr line background. |

### Dark

| Token | Value |
| --- | --- |
| `--nui-bg` | `#000000` |
| `--nui-surface` | `#141414` |
| `--nui-line` | `#242424` |
| `--nui-text` | `#F5F5F5` |
| `--nui-text-2` | `#A3A3A3` |
| `--nui-text-3` | `#8A8A8A` |
| `--nui-gold` | `#D4A42A` |
| `--nui-gold-text` | `#E0B649` |
| `--nui-gold-ink` | `#1A1300` |
| `--nui-gold-soft` | `rgba(212,164,42,0.16)` |

### What gold means

Gold is spent on three things only, so that it always means something:

1. **Mapr.** The spark mark and the Mapr line.
2. **The one main action on a screen.** One gold button per screen, at most.
3. **Your progress.** Places found, checked in, the progress ring.

Everything else is black, gray or white. If a screen has gold in a fourth
place, take it out.

### Text on photos

White text on a dark gradient, in both light and dark mode:
`linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0) 60%)`. Never put
gold or black text on a photo.

---

## 4. Type

Inter only, weights 400, 500, 600, 700 and 800 (already loaded in
`index.html`). Numbers use `font-variant-numeric: tabular-nums` where they
line up (times, counts).

| Role | Size / line | Weight | Tracking |
| --- | --- | --- | --- |
| Large title (screen name) | 32 / 38 | 800 | -0.02em |
| Title on a photo | 28 / 32 | 800 | -0.02em |
| Section heading | 20 / 26 | 700 | -0.01em |
| Row / card title | 16 / 22 | 600 | -0.005em |
| Body | 15 / 22 | 400 | 0 |
| Mapr line | 15 / 22 | 500 | 0 |
| Meta (secondary) | 13 / 18 | 400 | 0 |
| Label (over a section) | 11 / 14 | 600, UPPERCASE | 0.08em |
| Button | 15 / 20 | 600 | 0 |

Rules: sentence case everywhere except the small uppercase label. No emoji in
titles. No serif. No all-caps headlines.

---

## 5. Spacing

A 4 pt grid.

- Side gutter: **16**.
- Between sections: **28**. Section heading to its content: **12**.
- Inside a card: **12** (row padding **14** top and bottom).
- Between cards in a row: **12**. Between chips: **8**.
- Tap targets at least **44 x 44**.
- No boxes inside boxes: a section is a heading and content on the white
  page, divided by space or one hairline, not a card around a list of cards.

## 6. Corners

| Thing | Radius |
| --- | --- |
| Photo card, place card | 14 |
| Hero photo (full width, top of a screen) | 0 at the top, 20 at the bottom |
| Sheet (over the map) | 20 at the top |
| Button, chip, search field, segmented control | full pill (999) |
| Small thumbnail (in a row) | 10 |
| Mapr line | 14 |

## 7. Elevation

Flat. Cards sit on the white page with a 1 px `--nui-line` border, no shadow.
Only things that float over other things get a shadow: a sheet over a map, a
floating button. Shadow: `0 8px 24px rgba(0,0,0,0.08)` in light mode, none in
dark mode (use the border instead).

## 8. Motion

Quiet means still. Mapr is the only thing that moves on its own.

- **Press:** scale to 0.97 in 120 ms, back in 200 ms, `ease-out`.
- **State change** (chip select, tab switch): 200 ms `cubic-bezier(0.2, 0, 0, 1)`
  on color and background only.
- **New content** (a screen, a list): fade in and rise 8 px over 240 ms;
  stagger list items 30 ms, at most 6 items.
- **Sheets:** spring, no overshoot you can see (Apple default).
- **Mapr:** the spark turns a quarter and settles once when Mapr starts
  speaking (600 ms). It never loops forever. While Mapr is thinking, the spark
  pulses softly (opacity 0.5 to 1, 1.2 s) and stops the moment the answer
  lands.
- `prefers-reduced-motion: reduce` turns off every movement; color changes
  stay.

## 9. Mapr, the Character

Mapr is a personal companion and guide. It knows your taste and walks the trip
with you. It is not a pet (no face, no moods, no feeding, no levels) and not a
tool (no magic wand, no "AI-powered" label).

**How Mapr looks**

- The mark is the gold four-point spark (the same shape as the Mapr tab
  icon). It is the only icon drawn in gold outside of progress.
- On any screen that is not the chat, Mapr speaks through the **Mapr line**:
  the spark, then one or two sentences, on `--nui-gold-soft` with 14 pt
  corners. One Mapr line per screen, at the top of what it is about.
- Mapr never takes over the screen, never pops up uninvited, and never covers
  a photo.

**How Mapr talks**

- First person, present tense, short: "I found three stops that fit your
  afternoon." Two sentences at most on a screen.
- Specific to you, with the reason: "Because you liked Vizcaya", "It's a
  12 minute walk from your last stop."
- Facts name their source. No prices, hours, ratings or rankings. No opinion
  words: best, famous, iconic, must-see, hidden gem, amazing.
- No exclamation marks. No emoji. No "As an AI". No "Great choice".
- When unsure, says so plainly: "I don't know when it opens. Here's the
  source I'd check."

**How the app talks (everything that is not Mapr)**

- Plain nouns for labels: Plan, Places, Trip, Directions, Check in.
- Buttons say what happens: "Add to trip", not "Let's go".
- Counts are plain: "2 of 5 found", not "You're crushing it".

## 10. Parts

Use these before making a new one. Each has a class in `NewUILab.css`.

- **Large title** (`.nui-title`) with the date line above it in the label style.
- **Mapr line** (`.nui-mapr`): spark plus one or two sentences.
- **Primary button** (`.nui-btn-primary`): gold fill, gold-ink text, pill.
  One per screen.
- **Secondary button** (`.nui-btn`): white (black in dark) with a hairline
  border, pill.
- **Chip** (`.nui-chip`): surface pill; selected is gold-soft with gold-text.
- **Place card** (`.nui-card`): photo (14 pt corners), name below in 16/600,
  the "why you" line below in 13 gray. Nothing drawn on the photo.
- **Hero** (`.nui-hero`): full-width photo, white title on the dark gradient.
- **Fact row** (`.nui-fact`): the fact in body text, its source as a small gray
  link under it.
- **Stop** (`.nui-stop`): numbered gold circle (gold when found, outlined when
  not), time in tabular numbers, place name, walk time between stops.
- **Progress ring** (`.nui-ring`): gold arc on a hairline circle, "2 of 5".
- **Segmented control** (`.nui-seg`): surface pill, selected segment is the
  page color with a hairline.
- **Tab bar** (`.nui-tabbar`): page color with a hairline on top, gray icons
  and labels; the current tab is gold.
- **Map sheet** (`.nui-sheet`): 20 pt top corners over the map, a grip, the
  heading, one Mapr line, a row of place cards. Map pins are gray; Mapr's
  picks are numbered gold pins.
- **Trip card** (`.nui-trip`): three photos, name, when · places · time.
- **Stats** (`.nui-stats`): three numbers in one hairline card.

## 11. Checklist before shipping a screen

- [ ] White page (black in dark mode), no cream, no brand-color fields.
- [ ] Gold appears only for Mapr, the one main action, and progress.
- [ ] Inter only; sizes from the type table.
- [ ] 16 pt gutter, 4 pt grid, pills for every button.
- [ ] No ratings, prices, hours, opinion words; every fact has a source.
- [ ] At most one Mapr line; Mapr's words follow section 9.
- [ ] Text on photos is white on the dark gradient.
- [ ] Nothing moves on its own except the Mapr spark; reduced motion respected.
- [ ] Screenshotted in light and dark mode.
