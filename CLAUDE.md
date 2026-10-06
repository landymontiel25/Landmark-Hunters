# Working on this repo

This project is shared between two people working from separate machines/sessions
(local Mac + Claude Code on the web). GitHub is the single source of truth — not
iCloud, not any local folder.

- A `SessionStart` hook (`.claude/hooks/session-start.sh`) auto-pulls the latest
  commit from `origin` at the start of every session, as long as the branch has
  an upstream and there are no uncommitted local changes in the way. If it warns
  about diverged history or uncommitted changes, run `git status` and resolve
  that before making edits.
- After finishing a change: commit and `git push -u origin <branch-name>`. Don't
  leave work uncommitted/unpushed at the end of a session — the other person's
  session can't see it otherwise.
- Don't both work directly on `main` at the same time. Whoever starts second
  should branch off (`git checkout -b <name>`) and open a PR to merge back in,
  the same way PR #1 (Firebase security rules) was done.
- Whenever a change adds, renames, or removes a user-facing feature or flow,
  update `APP_HELP` in `api/_lib/appHelp.js` in the same PR. That string is
  the only thing Mapr (the app's one AI assistant, `api/plan-ai.js`) knows
  about how the app works — it goes stale fast if this is skipped, and Mapr
  then confidently tells users a shipped feature doesn't exist.
- Mapr changes apply to EVERY Mapr surface, never just one. Mapr is every
  place the app recommends or ranks places for a user: the Map tab's
  "Picked for you" sheet and its rows (Because you liked, moods, meal,
  nearby interest), Mapr chat (`api/plan-ai.js`), Travel Picks
  (`api/mapr-picks.js`), the trip planner ("The usual" / "Something new"),
  the landmark list's ordering, and any surface added later. When a change
  touches how Mapr scores, ranks, learns or logs, wire it into all of them
  in the same PR through the shared pipeline in `src/lib/maprRank/`, and
  list each surface in the PR description. Don't ask whether to include the
  others; the answer is always yes.
- Permanent rule from the owner: for EVERY change they ask for, always open a
  PR and then merge and deploy it yourself, without asking. Commit, push the
  branch, open the PR, and merge it into `main` once tests, lint and build
  pass (Vercel deploys `main`). Never leave finished work on a branch waiting
  for the owner to merge it.
- Owner stats never go in the app. They live in the separate admin
  dashboard (`admin-dashboard/`, its own Vercel project, README there). New
  admin metrics: write them from the nightly job (`api/_lib/dashboardDocs.js`),
  add a read rule using `isDashboard()` in `firestore.rules`, and show them on
  a dashboard page. Admin actions go through `api/admin-jobs.js`.
- Read `docs/open-work.md` at the start of a session. It lists unfinished work
  and the decisions behind it. Update it in the same PR when you finish an
  item or leave one half done.

# Importing places (Miami, Philly, Villanova, SF, Silicon Valley)

Each region's process is written up: `docs/sf-import/README.md` (SF and
Silicon Valley, research first) and `scripts/osm-import/research/README.md`
(Miami, Philly, Villanova, OpenStreetMap first). Read the one you need before
touching `public/places/` or `scripts/osm-import/`. The owner's standing rules:

- Every fact cites the URL that states it. A fact without a source stays out.
  No prices, hours, ratings, rankings or opinion words (best, famous, iconic).
- A place counts as acclaimed only with a 2025 or 2026 award or list, and the
  fact names the year.
- No coordinate is typed by hand. A place goes on the map only when
  OpenStreetMap (Nominatim) returns it at the researched address.
- A new region's import must leave every other region's pack files unchanged.
  Check `git diff` on `public/places/` and `src/data/placePacks.manifest.js`.
- Long research runs go in their own cloud session with a dollar budget the
  owner sets ($180 for SF + Silicon Valley, which used $96). Commit each
  finished batch so a usage limit or crash loses nothing, and stop at a
  clean, merged point if the run heads well past the budget.
- Report times to the owner in Eastern Time.
