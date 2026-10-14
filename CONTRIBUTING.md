# Contributing

Thanks for wanting to help. This is a personal finance app, so a few rules are
stricter than in most projects. They exist because a mistake here can expose
someone's bank data, not to make contributing hard.

## Read these first

- [`AGENTS.md`](AGENTS.md) holds the rules every contributor and AI agent
  follows: the plan is the source of truth, the order milestones are built in,
  the guardrails on sensitive data, money, providers and access, and what needs
  explicit sign-off before you do it.
- [`docs/trapstoknow.md`](docs/trapstoknow.md) lists mistakes that pass the gate
  and fail somewhere else. Read it before debugging a build, a test or a screen.
- [`docs/LOCAL-DEV.md`](docs/LOCAL-DEV.md) explains how to run the app and the
  gate on your machine, and [`setup/README.md`](setup/README.md) how to install
  your own copy (own Neon, Vercel and Plaid accounts).
- [`docs/plan/IMPLEMENTATION-PLAN.md`](docs/plan/IMPLEMENTATION-PLAN.md) is the
  plan. Its settled decisions are not reopened; if your change seems to need a
  different decision, ask first.

## The gate

Run this locally before you open a pull request. Do not push just to see a
deploy; Vercel build minutes cost money.

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Do not skip, delete or weaken a test to make it pass, and do not disable a
linter instead of fixing what it found.

## The no real data rule

Never put real personal or financial data anywhere: not in a test, fixture,
seed, log line, issue, commit message, screenshot or chat with an agent. That
includes values copied from a real bank, account or document.

- Against Plaid, use Sandbox and only Plaid's documented test credentials.
- Everywhere else, generate fresh synthetic values that cannot belong to a real
  person.
- The app never invents financial figures either: with nothing linked, a screen
  shows dashes and "Nothing here yet".

If you accidentally commit a secret or real data, say so in the pull request;
the value will be rotated. Removing the commit is not enough.

## Logging

Only `apps/app/src/server/log.ts` may call `console`, and it accepts a fixed set
of safe fields. A test fails the gate on any other `console` call. Log an
exception with `logException`, never its message.

## Pull requests

- Keep the diff small and on one subject. Explain why before what, define
  terms, and name the files you touched (see "Writing voice" in `AGENTS.md`).
- Add or update tests with the change. A new table needs row-level security and
  a test that a second account sees nothing.
- New dependencies need a note on their maintenance and licence in the pull
  request description. Prefer none.
- Fix a pull request by committing to its branch; do not open a second one that
  "supersedes" it.
- Report security problems privately, not in a pull request: see
  [`SECURITY.md`](SECURITY.md).

## Licence

MMFF-App is licensed under the Mozilla Public License 2.0; the full text is in
[`LICENSE`](LICENSE). By contributing, you agree your contribution is licensed
under the same terms.
