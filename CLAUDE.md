@AGENTS.md
@docs/trapstoknow.md

# At the start of every session

`AGENTS.md` (the rules) and `docs/trapstoknow.md` (the traps) are loaded
above. Before picking up work, also read:

- `docs/LOCAL-DEV.md` — how to run the app and the gate on this machine.
- `docs/plan/IMPLEMENTATION-PLAN.md` — §1 (the settled decisions), the
  sequence section and the plan entry for the issue you are taking.

# Working agreements

- **Develop the issues in milestone order: M0 → M1 → M2 → …**, the phases in
  the plan's sequence section. Take the next issue from the earliest milestone
  with open work, in the plan's issue-number order. Any exception is one the
  plan names. If the next issue is blocked, ask before skipping ahead. See
  "Work order" in `AGENTS.md`.
- **Fixing a PR means committing on that PR's branch.** Conflict resolutions,
  CI fixes and review-comment fixes go to the branch the pull request already
  tracks, never to a side branch or a second pull request that "supersedes"
  the first. Merge the base branch into the PR branch and push; do not rebase,
  amend or force-push somebody else's branch.
- **Test locally, not on Vercel.** Build minutes cost money. The gate is
  `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, run per
  `docs/LOCAL-DEV.md`. Never push just to see a deploy.
- **Sandbox and test mode only.** Use Stripe test mode and each provider's
  sandbox for all development, and never run migrations against a live project
  from a dev session.
- **Write code a human can read.** Follow "Writing readable code" in
  `AGENTS.md`:
  - a one-line *why* at the top of each file;
  - a short *what* comment above each block;
  - early returns instead of nesting;
  - named helpers instead of long functions.

  A long explanatory header is not a substitute.
- **Never paste real personal data anywhere** — not into a test, a fixture, a
  seed, a log line, an issue, a commit or a chat with an agent, and never a
  value copied from a real document or account. Against a vendor's sandbox, use
  only that vendor's documented test values; everywhere else, generate a fresh
  value each run that cannot belong to a real person. The full rule is under
  "Test data" in `AGENTS.md`.
