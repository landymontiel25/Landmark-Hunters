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
